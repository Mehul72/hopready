import { HeaderHeightContext } from 'expo-router/react-navigation';
import { type ComponentRef, type ReactNode, use, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  ScrollView,
  type ScrollViewProps,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { type Edge, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MAX_CONTENT_WIDTH, SPACING, useTheme } from '@/theme';

import { DemoModeBanner } from './demo-mode-banner';
import { useScreenPresentation } from './screen-presentation';

export interface ScreenProps {
  children: ReactNode;
  // Scrolling screens let iOS place content below the header and above the tab bar. A fixed
  // screen, such as a full-screen map, handles its own insets through `safeAreaEdges`.
  scroll?: boolean;
  safeAreaEdges?: readonly Edge[];
  // Pinned under the content and lifted above the keyboard, for the screen's main action. For
  // stack and modal screens: on a tab screen the tab bar would cover it.
  footer?: ReactNode;
  refreshControl?: ScrollViewProps['refreshControl'];
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

// The frame for every screen: background colour, safe areas, scrolling, keyboard handling, a
// readable width on wide windows, and the demo banner inside modal sheets.
export function Screen({
  children,
  scroll = true,
  safeAreaEdges = [],
  footer,
  refreshControl,
  contentContainerStyle,
  testID,
}: ScreenProps) {
  const { colours } = useTheme();
  const insets = useSafeAreaInsets();
  const presentation = useScreenPresentation();
  // The native stack's header floats over the screen, so fixed content must start below it. A
  // scrolling screen gets this from iOS through contentInsetAdjustmentBehavior. Outside a
  // navigator, as in tests, there is no header.
  const headerHeight = use(HeaderHeightContext) ?? 0;
  const containerRef = useRef<ComponentRef<typeof View>>(null);
  // KeyboardAvoidingView measures against its parent, not the window. In a sheet or below the
  // demo strip that parent starts lower down, so the offset to the window top is passed in.
  const [windowTop, setWindowTop] = useState(0);

  const inModal = presentation === 'modal';
  const edgePadding: ViewStyle = {
    // A shown header already covers the status bar, so its height replaces the top inset.
    paddingTop: headerHeight > 0 ? headerHeight : safeAreaEdges.includes('top') ? insets.top : 0,
    paddingBottom: safeAreaEdges.includes('bottom') && !footer ? insets.bottom : 0,
    paddingLeft: safeAreaEdges.includes('left') ? insets.left : 0,
    paddingRight: safeAreaEdges.includes('right') ? insets.right : 0,
  };

  const body = scroll ? (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      refreshControl={refreshControl}
      style={styles.fill}
      contentContainerStyle={[styles.scrollContent, contentContainerStyle]}>
      <View style={styles.readableWidth}>
        {inModal ? <DemoModeBanner placement="inline" /> : null}
        {children}
      </View>
    </ScrollView>
  ) : (
    <View
      style={[styles.fill, edgePadding, contentContainerStyle]}
      testID={testID ? `${testID}-content` : undefined}>
      {inModal ? <DemoModeBanner placement="compact" style={styles.fixedBanner} /> : null}
      {children}
    </View>
  );

  return (
    <View
      ref={containerRef}
      testID={testID}
      onLayout={() =>
        containerRef.current?.measureInWindow((_x, y) => {
          setWindowTop(y);
        })
      }
      style={[styles.fill, { backgroundColor: colours.background }]}>
      <KeyboardAvoidingView
        behavior="padding"
        enabled={Boolean(footer)}
        keyboardVerticalOffset={windowTop}
        style={styles.fill}>
        {body}
        {footer ? (
          <View
            style={[
              styles.footer,
              {
                backgroundColor: colours.background,
                borderTopColor: colours.separator,
                paddingBottom: Math.max(insets.bottom, SPACING.lg),
              },
            ]}>
            <View style={styles.readableWidth}>{footer}</View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  readableWidth: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    gap: SPACING.md,
    alignSelf: 'center',
  },
  fixedBanner: {
    margin: SPACING.lg,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
  },
});
