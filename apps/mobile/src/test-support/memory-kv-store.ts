import type { KeyValueBackend } from '@/storage/backend';

// Stands in for expo-sqlite/kv-store in Jest: the synchronous calls HopReady uses, kept in a Map.
export class MemoryKeyValueStore {
  readonly values = new Map<string, string>();

  getItemSync(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItemSync(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItemSync(key: string): boolean {
    return this.values.delete(key);
  }

  getAllKeysSync(): string[] {
    return [...this.values.keys()];
  }

  clearSync(): boolean {
    this.values.clear();
    return true;
  }
}

// A backend for createAppStorage, so a test can start from any stored state it writes into `values`.
export function createMemoryBackend(
  initial: Record<string, string> = {},
): KeyValueBackend & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    getAllKeys: () => [...values.keys()],
  };
}
