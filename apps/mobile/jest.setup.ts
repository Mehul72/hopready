// TypeScript 6 no longer loads @types packages by itself. This file is part of the app's type
// check, so this line makes Jest's globals known to every test file.
/// <reference types="jest" />

// Native modules replaced for every test. Each mock lives in src/test-support/mocks, so a test can
// import it to script answers or read what was called.

jest.mock('expo-sqlite/kv-store', () => require('./src/test-support/mocks/kv-store'));
jest.mock('expo-crypto', () => require('./src/test-support/mocks/expo-crypto'));
jest.mock('expo-network', () => require('./src/test-support/mocks/expo-network'));
jest.mock('expo-location', () => require('./src/test-support/mocks/expo-location'));
jest.mock('expo-symbols', () => require('./src/test-support/mocks/expo-symbols'));
jest.mock('react-native-maps', () => require('./src/test-support/mocks/react-native-maps'));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
