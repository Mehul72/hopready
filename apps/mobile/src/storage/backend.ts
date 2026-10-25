import { Storage } from 'expo-sqlite/kv-store';

// The few operations HopReady's storage needs. Tests swap in an in-memory map through the same shape.
export interface KeyValueBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  getAllKeys(): string[];
}

// Synchronous calls let a screen render saved data on its first frame, with no loading state.
// The values are small JSON documents, so each call is a single quick SQLite statement.
export const sqliteBackend: KeyValueBackend = {
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
  removeItem: (key) => {
    Storage.removeItemSync(key);
  },
  getAllKeys: () => Storage.getAllKeysSync(),
};
