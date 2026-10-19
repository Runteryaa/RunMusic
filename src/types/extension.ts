/**
 * RunMusic Evrensel Eklenti (Extension) Sistemi Veri Tipleri & Manifest Standardı
 */

export type ExtensionCategory =
  | 'audio-source'
  | 'media-server'
  | 'lyrics-provider'
  | 'metadata-provider'
  | 'charts-discovery'
  | 'audio-tools'
  | 'other';

export type ExtensionPermission =
  | 'player.control'
  | 'downloader.save'
  | 'storage.scoped'
  | 'theme.read'
  | 'library.read'
  | 'ui.toast';

export interface ExtensionSettingOption {
  label: string;
  value: string | number | boolean;
}

export interface ExtensionSettingItem {
  key: string;
  type: 'text' | 'number' | 'boolean' | 'select';
  title: string;
  description?: string;
  options?: ExtensionSettingOption[];
  default?: any;
}

export interface ExtensionAuthor {
  name: string;
  url?: string;
}

export interface ExtensionManifest {
  $schema?: string;
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string | ExtensionAuthor;
  icon?: string;
  homepage?: string;
  entryUrl: string;
  categories?: (ExtensionCategory | string)[];
  permissions?: (ExtensionPermission | string)[];
  settingsSchema?: ExtensionSettingItem[];
}

export interface InstalledExtension {
  manifest: ExtensionManifest;
  manifestUrl: string;
  installedAt: number;
  updatedAt: number;
  isEnabled: boolean;
  settings: Record<string, any>;
  storage: Record<string, any>; // Scoped key-value storage per extension
}

export interface ExtensionBridgeRequest {
  id: string;
  scope: 'player' | 'downloader' | 'storage' | 'theme' | 'library' | 'ui';
  action: string;
  payload?: any;
}

export interface ExtensionBridgeResponse {
  responseId?: string;
  success: boolean;
  data?: any;
  error?: string;
  event?: string;
}
