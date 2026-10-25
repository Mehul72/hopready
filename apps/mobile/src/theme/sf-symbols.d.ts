// The app's deployment target is iOS 16.4, which ships SF Symbols 4.2. A newer symbol renders as
// nothing there, so the type checker only accepts symbols that exist on every supported iOS.
export {};

declare module 'sf-symbols-typescript' {
  interface Overrides {
    SFSymbolsVersion: '4.2';
  }
}
