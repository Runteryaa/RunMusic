import { Alert as RNAlert, AlertButton, AlertOptions } from 'react-native';
import { useAlertStore } from '../store/useAlertStore';

let isAlertInstalled = false;

export function installGlobalAlert(): void {
  if (isAlertInstalled) return;
  isAlertInstalled = true;

  RNAlert.alert = (
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: AlertOptions
  ) => {
    const resolvedButtons: AlertButton[] =
      buttons && buttons.length > 0
        ? buttons
        : [{ text: 'Tamam' }];

    useAlertStore.getState().showAlert({
      title,
      message,
      buttons: resolvedButtons,
      options,
    });
  };
}

export function showCustomAlert(
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: AlertOptions
): void {
  RNAlert.alert(title, message, buttons, options);
}
