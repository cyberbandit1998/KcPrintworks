import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/** False during server render and hydration, true afterwards. Avoids flashing an empty cart. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
