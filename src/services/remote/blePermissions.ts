import { PermissionsAndroid, Platform } from 'react-native';
import { t } from '../i18n';

/**
 * Requests required runtime permissions for BLE (Central & Peripheral).
 * Android 12+ (API 31+) requires BLUETOOTH_SCAN, BLUETOOTH_CONNECT, BLUETOOTH_ADVERTISE.
 * Android <= 11 requires ACCESS_FINE_LOCATION.
 */
export async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  try {
    const apiLevel = typeof Platform.Version === 'number'
      ? Platform.Version
      : parseInt(String(Platform.Version), 10);

    if (apiLevel >= 31) {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
      ]);

      const scanGranted =
        results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED;
      const connectGranted =
        results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;
      const advertiseGranted =
        results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE] === PermissionsAndroid.RESULTS.GRANTED;

      return scanGranted && connectGranted && advertiseGranted;
    } else {
      const locationGranted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: t('remote.ble_permission_title'),
          message: t('remote.ble_permission_msg'),
          buttonPositive: t('remote.grant_permission'),
          buttonNegative: t('common.cancel'),
        }
      );
      return locationGranted === PermissionsAndroid.RESULTS.GRANTED;
    }
  } catch (err) {
    console.warn('Error requesting BLE permissions:', err);
    return false;
  }
}
