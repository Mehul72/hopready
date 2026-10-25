import { randomUUID } from 'expo-crypto';

import { createAppStorage } from './app-storage';
import { sqliteBackend } from './backend';

// The one storage instance the app uses. Tests build their own with createAppStorage and an
// in-memory backend when they need a clean slate.
export const appStorage = createAppStorage(sqliteBackend, randomUUID);
