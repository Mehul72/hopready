import { View, type ViewProps } from 'react-native';

// SF Symbols are native images; in Jest a plain view keeps the symbol name for assertions.
export function SymbolView({ name, ...viewProps }: ViewProps & { name: unknown }) {
  return <View {...viewProps} testID={viewProps.testID ?? `symbol:${String(name)}`} />;
}
