import { create } from 'zustand';
import type { AlertButton, AlertOptions } from 'react-native';

export interface AlertConfig {
  title: string;
  message?: string;
  buttons?: AlertButton[];
  options?: AlertOptions;
}

interface AlertStoreState {
  currentAlert: AlertConfig | null;
  showAlert: (config: AlertConfig) => void;
  hideAlert: () => void;
}

export const useAlertStore = create<AlertStoreState>((set) => ({
  currentAlert: null,
  showAlert: (config) => set({ currentAlert: config }),
  hideAlert: () => set({ currentAlert: null }),
}));
