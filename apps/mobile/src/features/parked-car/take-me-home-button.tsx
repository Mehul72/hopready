import type { Place } from '@hopready/core';
import { useState } from 'react';

import { Button, Chip } from '@/components';
import { appStorage, type ParkedCarState } from '@/storage';
import { returnTripFor } from '@/trip';

import { findCurrentPlace } from '../saved/current-location';
import { asFixedPlace } from '../saved/place-labels';
import { PlacePickerSheet } from '../saved/place-picker-sheet';
import { leaveNowRequest, showResultsFor } from '../saved/plan-requests';
import { writeOrAlert } from '../saved/storage-writes';

type Step =
  | { kind: 'idle' }
  | { kind: 'locating' }
  // The location could not be used, so the person says where they are.
  | { kind: 'choose-origin'; problem: string }
  // Home is not set, so the person says where home is.
  | { kind: 'choose-destination'; origin: Place };

// Plans the way home from where the person is now: back through the confirmed parked car
// (return-via-car), or by public transport only after a drop-off (return-without-car).
export function TakeMeHomeButton({ parkedCar }: { parkedCar: ParkedCarState }) {
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [saveAsHome, setSaveAsHome] = useState(true);

  const planHome = (origin: Place, home: Place) => {
    setStep({ kind: 'idle' });
    const { trip, access } = returnTripFor(parkedCar);
    showResultsFor(
      leaveNowRequest(
        { origin, destination: home, access, trip, now: new Date() },
        // The way back never parks anywhere new, so saved spots are not offered.
        { preferences: appStorage.preferences.get(), parkingSpots: [] },
      ),
    );
  };

  const continueFrom = (origin: Place) => {
    const home = appStorage.places.get().home;
    if (home) {
      planHome(origin, home);
      return;
    }
    setStep({ kind: 'choose-destination', origin });
  };

  const start = async () => {
    setStep({ kind: 'locating' });
    const outcome = await findCurrentPlace();
    if (outcome.status === 'found') {
      continueFrom(outcome.place);
      return;
    }
    setStep({ kind: 'choose-origin', problem: `${outcome.message} Where are you now?` });
  };

  const pickHome = (origin: Place, picked: Place) => {
    const home = asFixedPlace(picked);
    if (saveAsHome) writeOrAlert(() => appStorage.places.setHome(home), "Couldn't save Home");
    planHome(origin, home);
  };

  const sheet =
    step.kind === 'choose-origin'
      ? {
          title: 'Where are you now?',
          notice: step.problem,
          allowCurrentLocation: false,
          onPick: continueFrom,
          accessory: null,
        }
      : step.kind === 'choose-destination'
        ? {
            title: "Where's home?",
            notice: null,
            allowCurrentLocation: false,
            onPick: (picked: Place) => pickHome(step.origin, picked),
            accessory: (
              <Chip
                label="Also save as Home"
                selected={saveAsHome}
                onToggle={setSaveAsHome}
                accessibilityHint="Next time, Take me home goes straight there"
              />
            ),
          }
        : null;

  return (
    <>
      <Button
        label="Take me home"
        symbol="house.fill"
        fullWidth
        loading={step.kind === 'locating'}
        accessibilityHint={
          parkedCar.status === 'parked'
            ? 'Plans your way back through your parked car'
            : 'Plans your way home by public transport'
        }
        onPress={() => {
          void start();
        }}
      />
      <PlacePickerSheet
        visible={sheet !== null}
        title={sheet?.title ?? ''}
        notice={sheet?.notice}
        allowCurrentLocation={sheet?.allowCurrentLocation ?? false}
        accessory={sheet?.accessory}
        resetKey={step.kind}
        onPick={(place) => sheet?.onPick(place)}
        onClose={() => setStep({ kind: 'idle' })}
      />
    </>
  );
}
