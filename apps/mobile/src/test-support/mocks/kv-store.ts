import { MemoryKeyValueStore } from '../memory-kv-store';

// One shared in-memory store per test file, under every name expo-sqlite/kv-store exports.
const store = new MemoryKeyValueStore();

export const Storage = store;
export const AsyncStorage = store;
export default store;
