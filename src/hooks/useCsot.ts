import { useSyncExternalStore } from 'react';
import { csot } from '../services/csot';

// Re-renders the caller whenever any CSOT topic changes (or the connection
// status flips). Read the actual data with csot.collection(...) / csot.presence()
// right after calling this.
export function useCsotVersion(): number {
  return useSyncExternalStore(
    (cb) => csot.subscribe(cb),
    () => csot.version,
    () => csot.version,
  );
}

export function useCsotStatus() {
  useCsotVersion();
  return csot.status;
}
