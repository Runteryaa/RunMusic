//! Thin WinRT BLE layer: active scanner and a subscribed GATT link.
//!
//! Everything here is blocking. It is only called from the dedicated BLE
//! thread, so no async runtime is needed.

use crossbeam_channel::Sender;
use windows::core::{GUID, IInspectable, Ref};
use windows::Devices::Bluetooth::Advertisement::{
    BluetoothLEAdvertisementFilter, BluetoothLEAdvertisementReceivedEventArgs,
    BluetoothLEAdvertisementWatcher, BluetoothLEScanningMode,
};
use windows::Devices::Bluetooth::GenericAttributeProfile::{
    GattCharacteristic, GattClientCharacteristicConfigurationDescriptorValue,
    GattCommunicationStatus, GattDeviceService, GattSession, GattValueChangedEventArgs,
    GattWriteOption,
};
use windows::Devices::Bluetooth::{
    BluetoothCacheMode, BluetoothConnectionStatus, BluetoothLEDevice,
};
use windows::Foundation::TypedEventHandler;
use windows::Storage::Streams::{DataReader, DataWriter};

use super::Control;
use crate::ndjson::NdjsonBuffer;
use crate::protocol::{
    CHAR_COMMAND_WRITE_UUID, CHAR_DEVICE_INFO_UUID, CHAR_QUEUE_LYRICS_UUID,
    CHAR_STATE_NOTIFY_UUID, SERVICE_UUID,
};

fn guid(value: u128) -> GUID {
    GUID::from_u128(value)
}

fn error_text(error: windows::core::Error) -> String {
    format!("{} (0x{:08X})", error.message(), error.code().0 as u32)
}

/// Active BLE scanner filtered to the RunMusic service.
pub struct Scanner {
    watcher: Option<BluetoothLEAdvertisementWatcher>,
    token: Option<i64>,
}

impl Scanner {
    pub fn start(control: Sender<Control>) -> Result<Self, String> {
        let watcher = BluetoothLEAdvertisementWatcher::new().map_err(error_text)?;
        watcher
            .SetScanningMode(BluetoothLEScanningMode::Active)
            .map_err(error_text)?;

        let filter = BluetoothLEAdvertisementFilter::new().map_err(error_text)?;
        filter
            .Advertisement()
            .map_err(error_text)?
            .ServiceUuids()
            .map_err(error_text)?
            .Append(guid(SERVICE_UUID))
            .map_err(error_text)?;
        watcher
            .SetAdvertisementFilter(&filter)
            .map_err(error_text)?;

        let control_tx = control.clone();
        let handler = TypedEventHandler::new(
            move |_sender: Ref<BluetoothLEAdvertisementWatcher>,
                  args: Ref<BluetoothLEAdvertisementReceivedEventArgs>| {
                if let Some(args) = args.as_ref() {
                    if let Ok(address) = args.BluetoothAddress() {
                        let name = args
                            .Advertisement()
                            .ok()
                            .and_then(|advertisement| advertisement.LocalName().ok())
                            .map(|value| value.to_string())
                            .unwrap_or_default();
                        let _ = control_tx.send(Control::Found { address, name });
                    }
                }
                Ok(())
            },
        );

        let token = watcher.Received(&handler).map_err(error_text)?;
        watcher.Start().map_err(error_text)?;

        Ok(Self {
            watcher: Some(watcher),
            token: Some(token),
        })
    }

    pub fn stop(&mut self) {
        if let (Some(watcher), Some(token)) = (self.watcher.as_ref(), self.token.take()) {
            let _ = watcher.Stop();
            let _ = watcher.RemoveReceived(token);
        }
        self.watcher = None;
    }
}

impl Drop for Scanner {
    fn drop(&mut self) {
        self.stop();
    }
}

/// A connected, subscribed RunMusic GATT link.
pub struct Link {
    device: BluetoothLEDevice,
    _service: GattDeviceService,
    session: GattSession,
    command: GattCharacteristic,
    state: GattCharacteristic,
    state_token: i64,
    /// 0xFEE3 carries `QUEUE_SYNC` and `LYRICS_SYNC`; absent on old hosts.
    lyrics: Option<GattCharacteristic>,
    lyrics_token: i64,
    connection_token: i64,
    pub parser: NdjsonBuffer,
    pub lyrics_parser: NdjsonBuffer,
    device_name: Option<String>,
}

impl Link {
    pub fn connect(address: u64, control: Sender<Control>) -> Result<Self, String> {
        let device = BluetoothLEDevice::FromBluetoothAddressAsync(address)
            .map_err(error_text)?
            .join()
            .map_err(error_text)?;
        let result = Self::connect_with_device(device.clone(), control);
        if result.is_err() {
            // Release the device object even when setup fails part-way through,
            // otherwise the next reconnect attempt can hit a stale GATT handle.
            let _ = device.Close();
        }
        result
    }

    fn connect_with_device(
        device: BluetoothLEDevice,
        control: Sender<Control>,
    ) -> Result<Self, String> {
        let services = device
            .GetGattServicesForUuidWithCacheModeAsync(guid(SERVICE_UUID), BluetoothCacheMode::Uncached)
            .map_err(error_text)?
            .join()
            .map_err(error_text)?;
        if services.Status().map_err(error_text)? != GattCommunicationStatus::Success {
            return Err("GATT servisleri okunamadı".to_string());
        }
        let services = services.Services().map_err(error_text)?;
        if services.Size().map_err(error_text)? == 0 {
            return Err("RunMusic servisi bulunamadı".to_string());
        }
        let service: GattDeviceService = services.GetAt(0).map_err(error_text)?;

        let command = find_characteristic(&service, CHAR_COMMAND_WRITE_UUID)?;
        let state = find_characteristic(&service, CHAR_STATE_NOTIFY_UUID)?;
        let lyrics_char = find_characteristic(&service, CHAR_QUEUE_LYRICS_UUID).ok();

        // Friendly name lives on 0xFEE4; the advertisement only carries the UUID.
        let device_name = find_characteristic(&service, CHAR_DEVICE_INFO_UUID)
            .ok()
            .and_then(|info| read_text(&info))
            .filter(|name| !name.is_empty());

        // Register the value handlers *before* enabling notifications. The host
        // starts sending a multi-chunk INITIAL_STATE right after the CCCD write
        // completes, and WinRT drops notifications received before a handler
        // is attached (which used to corrupt the first state payload).
        let notify_tx = control.clone();
        let state_token = state
            .ValueChanged(&TypedEventHandler::new(
                move |_sender: Ref<GattCharacteristic>, args: Ref<GattValueChangedEventArgs>| {
                    if let Some(args) = args.as_ref() {
                        if let Ok(buffer) = args.CharacteristicValue() {
                            if let Some(bytes) = read_buffer(&buffer) {
                                let _ = notify_tx.send(Control::Notification(bytes));
                            }
                        }
                    }
                    Ok(())
                },
            ))
            .map_err(error_text)?;

        // 0xFEE3 carries queue and lyrics updates (LYRICS_SYNC).
        let (lyrics, lyrics_token) = match lyrics_char {
            Some(lyrics_char) => {
                let lyrics_tx = control.clone();
                let token = lyrics_char
                    .ValueChanged(&TypedEventHandler::new(
                        move |_sender: Ref<GattCharacteristic>, args: Ref<GattValueChangedEventArgs>| {
                            if let Some(args) = args.as_ref() {
                                if let Ok(buffer) = args.CharacteristicValue() {
                                    if let Some(bytes) = read_buffer(&buffer) {
                                        let _ = lyrics_tx.send(Control::LyricsNotification(bytes));
                                    }
                                }
                            }
                            Ok(())
                        },
                    ))
                    .map_err(error_text)?;
                (Some(lyrics_char), token)
            }
            None => (None, 0),
        };

        let subscribe = state
            .WriteClientCharacteristicConfigurationDescriptorAsync(
                GattClientCharacteristicConfigurationDescriptorValue::Notify,
            )
            .map_err(error_text)?
            .join()
            .map_err(error_text)?;
        if subscribe != GattCommunicationStatus::Success {
            return Err(format!("Bildirim aboneliği başarısız: {subscribe:?}"));
        }
        if let Some(lyrics_char) = &lyrics {
            let _ = lyrics_char
                .WriteClientCharacteristicConfigurationDescriptorAsync(
                    GattClientCharacteristicConfigurationDescriptorValue::Notify,
                )
                .map_err(error_text)?
                .join();
        }

        let session = GattSession::FromDeviceIdAsync(&device.BluetoothDeviceId().map_err(error_text)?)
            .map_err(error_text)?
            .join()
            .map_err(error_text)?;
        let _ = session.SetMaintainConnection(true);


        let status_tx = control;
        let connection_token = device
            .ConnectionStatusChanged(&TypedEventHandler::new(
                move |_device: Ref<BluetoothLEDevice>, _args: Ref<IInspectable>| {
                    let connected = _device
                        .as_ref()
                        .and_then(|device| device.ConnectionStatus().ok())
                        .map(|status| status == BluetoothConnectionStatus::Connected)
                        .unwrap_or(false);
                    let _ = status_tx.send(Control::ConnectionChanged(connected));
                    Ok(())
                },
            ))
            .map_err(error_text)?;

        Ok(Self {
            device,
            _service: service,
            session,
            command,
            state,
            state_token,
            lyrics,
            lyrics_token,
            connection_token,
            parser: NdjsonBuffer::new(),
            lyrics_parser: NdjsonBuffer::new(),
            device_name,
        })
    }

    pub fn device_name(&self) -> Option<String> {
        self.device_name.clone()
    }

    pub fn max_pdu(&self) -> Option<u16> {
        self.session.MaxPduSize().ok()
    }

    /// Writes one already-framed chunk to the command characteristic.
    pub fn write(&self, data: &[u8], without_response: bool) -> Result<(), String> {
        let writer = DataWriter::new().map_err(error_text)?;
        writer.WriteBytes(data).map_err(error_text)?;
        let buffer = writer.DetachBuffer().map_err(error_text)?;

        if without_response {
            let status = self
                .command
                .WriteValueWithOptionAsync(&buffer, GattWriteOption::WriteWithoutResponse)
                .map_err(error_text)?
                .join()
                .map_err(error_text)?;
            if status != GattCommunicationStatus::Success {
                return Err(format!("Yazma başarısız: {status:?}"));
            }
        } else {
            let result = self
                .command
                .WriteValueWithResultAsync(&buffer)
                .map_err(error_text)?
                .join()
                .map_err(error_text)?;
            let status = result.Status().map_err(error_text)?;
            if status != GattCommunicationStatus::Success {
                return Err(format!("Yazma başarısız: {status:?}"));
            }
        }
        Ok(())
    }

    /// Sends a full command, chunked exactly like the host expects.
    pub fn send_command(&self, command: &crate::protocol::Command) -> Result<(), String> {
        let payload = command.to_ndjson().into_bytes();
        let without_response = command.is_seek();
        for chunk in payload.chunks(crate::protocol::BLE_CHUNK_SIZE) {
            self.write(chunk, without_response)?;
        }
        Ok(())
    }

}

impl Drop for Link {
    fn drop(&mut self) {
        let _ = self.state.RemoveValueChanged(self.state_token);
        if let Some(lyrics) = self.lyrics.as_ref() {
            if self.lyrics_token != 0 {
                let _ = lyrics.RemoveValueChanged(self.lyrics_token);
            }
        }
        let _ = self.device.RemoveConnectionStatusChanged(self.connection_token);
        let _ = self.session.SetMaintainConnection(false);
        let _ = self.device.Close();
    }
}

fn find_characteristic(
    service: &GattDeviceService,
    uuid: u128,
) -> Result<GattCharacteristic, String> {
    let result = service
        .GetCharacteristicsForUuidWithCacheModeAsync(guid(uuid), BluetoothCacheMode::Uncached)
        .map_err(error_text)?
        .join()
        .map_err(error_text)?;
    if result.Status().map_err(error_text)? != GattCommunicationStatus::Success {
        return Err("Karakteristik okunamadı".to_string());
    }
    let list = result.Characteristics().map_err(error_text)?;
    if list.Size().map_err(error_text)? == 0 {
        return Err(format!("Karakteristik yok: {uuid:032x}"));
    }
    list.GetAt(0).map_err(error_text)
}

fn read_text(characteristic: &GattCharacteristic) -> Option<String> {
    let result = characteristic
        .ReadValueWithCacheModeAsync(BluetoothCacheMode::Uncached)
        .ok()?
        .join()
        .ok()?;
    if result.Status().ok()? != GattCommunicationStatus::Success {
        return None;
    }
    let bytes = read_buffer(&result.Value().ok()?)?;
    String::from_utf8(bytes)
        .ok()
        .map(|text| text.trim().to_string())
}

fn read_buffer(buffer: &windows::Storage::Streams::IBuffer) -> Option<Vec<u8>> {
    let reader = DataReader::FromBuffer(buffer).ok()?;
    let length = reader.UnconsumedBufferLength().ok()? as usize;
    if length == 0 {
        return Some(Vec::new());
    }
    let mut bytes = vec![0u8; length];
    reader.ReadBytes(&mut bytes).ok()?;
    Some(bytes)
}
