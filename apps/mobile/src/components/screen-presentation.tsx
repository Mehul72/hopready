import { createContext, type ReactNode, use } from 'react';

export type ScreenPresentation = 'card' | 'modal';

const ScreenPresentationContext = createContext<ScreenPresentation>('card');

// The root layout wraps every screen in this, so a Screen knows when it is a modal sheet. Sheets
// cover the window-wide demo banner and then show their own.
export function ScreenPresentationProvider({
  presentation,
  children,
}: {
  presentation: ScreenPresentation;
  children: ReactNode;
}) {
  return <ScreenPresentationContext value={presentation}>{children}</ScreenPresentationContext>;
}

export function useScreenPresentation(): ScreenPresentation {
  return use(ScreenPresentationContext);
}
