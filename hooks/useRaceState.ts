"use client";

import { useSyncExternalStore } from "react";
import { raceStore, type RaceUIState } from "@/lib/race/raceClient";

/** Subscribe to a slice of the online-race UI state. */
export function useRaceState<T>(selector: (s: RaceUIState) => T): T {
  return useSyncExternalStore(
    raceStore.subscribe,
    () => selector(raceStore.getState()),
    () => selector(raceStore.getServerState()),
  );
}
