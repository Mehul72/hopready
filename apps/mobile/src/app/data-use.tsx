import { router } from 'expo-router';

import { LiveDataConsentScreen } from '@/features/consent';

export default function DataUseRoute() {
  return (
    <LiveDataConsentScreen
      variant="review"
      onDone={() => {
        if (router.canGoBack()) router.back();
      }}
    />
  );
}
