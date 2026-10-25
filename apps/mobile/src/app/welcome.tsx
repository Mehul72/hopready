import { LiveDataConsentScreen } from '@/features/consent';

// Shown instead of the app until the person agrees to live data use or chooses demo mode. The root
// layout's route guards then move them on, so this screen does not navigate itself.
export default function WelcomeRoute() {
  return <LiveDataConsentScreen variant="first-run" />;
}
