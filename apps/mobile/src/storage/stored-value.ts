import type { z } from 'zod';

import type { KeyValueBackend } from './backend';

// Every key HopReady writes starts with this, so "delete all data" can find them all, including
// keys left behind by older versions.
export const STORAGE_KEY_PREFIX = 'hopready.';

export class StorageError extends Error {
  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
    this.name = 'StorageError';
  }
}

export interface StoredValueDefinition<T> {
  // A fixed identifier such as 'preferences'. It appears in warnings, so it must never hold user data.
  name: string;
  // Bump when the stored shape changes incompatibly. The key changes with it, so an old value
  // can never be parsed with the new schema.
  version: number;
  schema: z.ZodType<T>;
  defaultValue: () => T;
  // For flat settings objects: fields added in a later release are filled from the defaults
  // instead of discarding everything the person already chose.
  fillMissingFromDefaults?: boolean;
  // Write the default the first time it is read, for values that must not change once created.
  persistDefault?: boolean;
  // When the version is bumped because a default changed meaning rather than shape, the value saved
  // under the previous version is carried over through `migrate` instead of being dropped.
  migrateFrom?: { version: number; migrate: (previous: unknown) => unknown };
}

export interface StoredValue<T> {
  readonly name: string;
  readonly key: string;
  // Returns the same object until the value changes, as useSyncExternalStore requires.
  get: () => T;
  // Validates with the schema and throws StorageError for invalid values or a failed write.
  set: (value: T) => void;
  update: (change: (current: T) => T) => T;
  subscribe: (listener: () => void) => () => void;
}

// What the storage module itself holds: the public value plus a way to drop the cached copy.
export interface ManagedStoredValue<T> extends StoredValue<T> {
  dropCachedValue: () => void;
}

export function storageKey(name: string, version: number): string {
  return `${STORAGE_KEY_PREFIX}${name}.v${version}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createStoredValue<T>(
  backend: KeyValueBackend,
  definition: StoredValueDefinition<T>,
): ManagedStoredValue<T> {
  const key = storageKey(definition.name, definition.version);
  const listeners = new Set<() => void>();
  let cached: { value: T } | null = null;

  function write(value: T) {
    try {
      backend.setItem(key, JSON.stringify(value));
    } catch (error) {
      throw new StorageError(`Could not save ${definition.name}`, { cause: error });
    }
  }

  function readRaw(): string | null {
    try {
      return backend.getItem(key);
    } catch (error) {
      throw new StorageError(`Could not read ${definition.name}`, { cause: error });
    }
  }

  // Null means unreadable: not JSON, or not the shape the schema expects.
  function parse(raw: string): { value: T; filledFromDefaults: boolean } | null {
    let stored: unknown;
    try {
      stored = JSON.parse(raw);
    } catch {
      return null;
    }
    let candidate = stored;
    let filledFromDefaults = false;
    if (definition.fillMissingFromDefaults && isPlainObject(stored)) {
      const defaults = definition.defaultValue();
      if (isPlainObject(defaults)) {
        filledFromDefaults = Object.keys(defaults).some((field) => !(field in stored));
        candidate = { ...defaults, ...stored };
      }
    }
    const result = definition.schema.safeParse(candidate);
    return result.success ? { value: result.data, filledFromDefaults } : null;
  }

  // The previous version's value, migrated, saved under the new key, with the old key removed.
  // Null when there is nothing to carry over or it cannot be read.
  function carryOver(): T | null {
    const from = definition.migrateFrom;
    if (!from) return null;
    const previousKey = storageKey(definition.name, from.version);
    let previousRaw: string | null;
    try {
      previousRaw = backend.getItem(previousKey);
    } catch (error) {
      throw new StorageError(`Could not read the previous ${definition.name}`, { cause: error });
    }
    if (previousRaw === null) return null;
    let previous: unknown = null;
    try {
      previous = JSON.parse(previousRaw);
    } catch {
      // Unreadable JSON is reported below, with the shapes the schema refuses.
    }
    const parsed = previous === null ? null : parse(JSON.stringify(from.migrate(previous)));
    if (!parsed) {
      // Only the fixed name is logged: the stored value may hold places or trips.
      console.warn(
        `HopReady storage: the previous ${definition.name} could not be read, so the defaults apply.`,
      );
      return null;
    }
    write(parsed.value);
    try {
      backend.removeItem(previousKey);
    } catch {
      // The carried-over value is already saved; the stale key only wastes space until "delete all
      // data", which removes every HopReady key.
      console.warn(`HopReady storage: the previous ${definition.name} could not be removed.`);
    }
    return parsed.value;
  }

  function load(): T {
    const raw = readRaw();
    if (raw === null) {
      const carried = carryOver();
      if (carried) return carried;
      const fallback = definition.defaultValue();
      if (definition.persistDefault) write(fallback);
      return fallback;
    }
    const parsed = parse(raw);
    if (parsed) {
      if (parsed.filledFromDefaults) write(parsed.value);
      return parsed.value;
    }
    // Only the fixed name is logged: the stored value may hold places or trips.
    console.warn(
      `HopReady storage: ${definition.name} could not be read and was reset to its default.`,
    );
    const fallback = definition.defaultValue();
    write(fallback);
    return fallback;
  }

  function notify() {
    for (const listener of [...listeners]) listener();
  }

  const get = (): T => {
    if (!cached) cached = { value: load() };
    return cached.value;
  };

  const set = (value: T) => {
    const result = definition.schema.safeParse(value);
    if (!result.success) {
      throw new StorageError(`Refused to save an invalid ${definition.name}`, {
        cause: result.error,
      });
    }
    write(result.data);
    cached = { value: result.data };
    notify();
  };

  return {
    name: definition.name,
    key,
    get,
    set,
    update: (change) => {
      set(change(get()));
      return get();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dropCachedValue: () => {
      cached = null;
      notify();
    },
  };
}
