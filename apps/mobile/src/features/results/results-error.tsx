import type { SFSymbol } from 'expo-symbols';
import { useEffect, useState } from 'react';

import type { ApiError, ApiErrorKind } from '@/api';
import { ErrorState } from '@/components';

export interface ResultsErrorProps {
  error: ApiError;
  onRetry: () => void;
  onUseDemoMode: () => void;
  onChangeTrip: () => void;
}

type NextStep = 'retry' | 'demo-mode' | 'change-trip';

interface ErrorPresentation {
  title: string;
  symbol: SFSymbol;
  nextStep: NextStep;
}

const PRESENTATIONS: Readonly<Record<ApiErrorKind, ErrorPresentation>> = {
  offline: { title: "You're offline", symbol: 'wifi.slash', nextStep: 'retry' },
  unreachable: { title: "Can't reach HopReady", symbol: 'icloud.slash', nextStep: 'retry' },
  timeout: { title: 'No answer in time', symbol: 'clock', nextStep: 'retry' },
  'rate-limited': { title: 'HopReady is busy', symbol: 'hourglass', nextStep: 'retry' },
  'not-configured': {
    title: "Live planning isn't set up",
    symbol: 'gearshape',
    nextStep: 'demo-mode',
  },
  'consent-required': {
    title: 'Live trips need your agreement',
    symbol: 'hand.raised',
    nextStep: 'demo-mode',
  },
  'outside-coverage': { title: 'Outside Greater Sydney', symbol: 'map', nextStep: 'change-trip' },
  rejected: {
    title: "Couldn't plan this trip",
    symbol: 'exclamationmark.circle.fill',
    nextStep: 'change-trip',
  },
  server: {
    title: "Couldn't get trip options",
    symbol: 'exclamationmark.circle.fill',
    nextStep: 'retry',
  },
  'invalid-response': {
    title: "Couldn't get trip options",
    symbol: 'exclamationmark.circle.fill',
    nextStep: 'retry',
  },
  cancelled: {
    title: "Couldn't get trip options",
    symbol: 'exclamationmark.circle.fill',
    nextStep: 'retry',
  },
  unexpected: {
    title: "Couldn't get trip options",
    symbol: 'exclamationmark.circle.fill',
    nextStep: 'retry',
  },
};

// A busy server says how long to wait. Offering "Try again" before then would only use up the
// shared allowance and fail the same way, so the button appears once the wait is over.
function useWaitIsOver(retryAfterSeconds: number | null): boolean {
  const mustWait = retryAfterSeconds !== null && retryAfterSeconds > 0;
  const [waitIsOver, setWaitIsOver] = useState(!mustWait);
  useEffect(() => {
    if (retryAfterSeconds === null || retryAfterSeconds <= 0) return;
    const timer = setTimeout(() => setWaitIsOver(true), retryAfterSeconds * 1000);
    return () => clearTimeout(timer);
  }, [retryAfterSeconds]);
  return waitIsOver;
}

export function ResultsError({ error, onRetry, onUseDemoMode, onChangeTrip }: ResultsErrorProps) {
  const presentation = PRESENTATIONS[error.kind];
  const waitIsOver = useWaitIsOver(error.kind === 'rate-limited' ? error.retryAfterSeconds : null);
  const offersDemoMode = presentation.nextStep === 'demo-mode' && error.suggestsDemoMode;

  return (
    <ErrorState
      title={presentation.title}
      message={error.message}
      symbol={presentation.symbol}
      onRetry={presentation.nextStep === 'retry' && waitIsOver ? onRetry : undefined}
      secondaryAction={
        offersDemoMode
          ? {
              label: 'Turn on demo mode',
              onPress: onUseDemoMode,
              accessibilityHint: 'Plans this trip again with sample data, labelled as demo',
            }
          : presentation.nextStep === 'change-trip' || presentation.nextStep === 'demo-mode'
            ? {
                label: 'Change the trip',
                onPress: onChangeTrip,
                accessibilityHint: 'Goes back to the trip you planned',
              }
            : undefined
      }
      testID="results-error"
    />
  );
}
