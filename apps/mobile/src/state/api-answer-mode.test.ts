import { appStorage } from '@/storage';

import { apiAnswerMode, createApiAnswerModeStore } from './api-answer-mode';

describe('the mode of the latest API answer', () => {
  it('holds nothing until the API answers, then the mode of its latest answer', () => {
    const store = createApiAnswerModeStore();
    const listener = jest.fn();
    store.subscribe(listener);
    expect(store.get()).toBeNull();

    store.record('demo');
    expect(store.get()).toBe('demo');
    // The same server, restarted without HOPREADY_MODE=demo.
    store.record('live');
    expect(store.get()).toBe('live');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('forgets the mode when all data is deleted, as the answers it labelled are gone too', () => {
    apiAnswerMode.record('demo');

    appStorage.deleteAllData();

    expect(apiAnswerMode.get()).toBeNull();
  });
});
