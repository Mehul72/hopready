import { useState } from 'react';
import { AccessibilityInfo, Alert, StyleSheet, View } from 'react-native';

import { AppText, Banner, Button } from '@/components';
import { appStorage } from '@/storage';

import { errorName } from '../saved/storage-writes';
import { SettingsSection } from './settings-section';

type DeletionResult = 'deleted' | 'failed' | null;

export const DELETE_ALL_EXPLANATION =
  'Removes Home and Work, favourites, saved routes, recent searches, parking spots, your parked car, the trip you are following and these settings from this iPhone. HopReady keeps no account, so nothing else needs deleting.';

export function DeleteDataSection() {
  const [result, setResult] = useState<DeletionResult>(null);

  const deleteEverything = () => {
    try {
      appStorage.deleteAllData();
      setResult('deleted');
      AccessibilityInfo.announceForAccessibility('All HopReady data deleted.');
    } catch (error) {
      // Logged by type only; whatever could be removed is gone, and the screens show what is left.
      console.warn(`HopReady: deleting all data failed (${errorName(error)}).`);
      setResult('failed');
    }
  };

  const confirm = () => {
    Alert.alert('Delete all HopReady data?', `${DELETE_ALL_EXPLANATION} This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete everything', style: 'destructive', onPress: deleteEverything },
    ]);
  };

  return (
    <SettingsSection title="Your data" testID="delete-data">
      <AppText tone="secondary">{DELETE_ALL_EXPLANATION}</AppText>
      {result === 'deleted' ? (
        <Banner tone="info" message="All HopReady data was deleted from this iPhone." />
      ) : null}
      {result === 'failed' ? (
        <Banner
          tone="error"
          title="Couldn't delete everything"
          message="Some data may still be on this iPhone. Try again."
          announce
        />
      ) : null}
      <View style={styles.action}>
        <Button
          variant="destructive"
          symbol="trash"
          label="Delete all HopReady data"
          onPress={confirm}
        />
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'flex-start',
  },
});
