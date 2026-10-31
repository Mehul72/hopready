// Unit and component tests for the app: `npx jest` from apps/mobile.
const preset = require('jest-expo/jest-preset');

const SCRIPTS = '\\.[jt]sx?$';
const [babelJest, babelOptions] = preset.transform[SCRIPTS];

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // The app ships with the React Compiler (app.config.ts), which caches values between renders.
  // Testing without it hides bugs such as a clock read the compiler keeps from an earlier render.
  transform: {
    ...preset.transform,
    [SCRIPTS]: [
      babelJest,
      { ...babelOptions, caller: { ...babelOptions.caller, supportsReactCompiler: true } },
    ],
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  clearMocks: true,
  restoreMocks: true,
};
