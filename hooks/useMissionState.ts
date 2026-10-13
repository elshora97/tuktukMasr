"use client";

import { useSyncExternalStore } from "react";
import { missionStore, type MissionUIState } from "@/lib/mission/missionStore";

/** Subscribe to a slice of the passenger-mission UI state. */
export function useMissionState<T>(selector: (s: MissionUIState) => T): T {
  return useSyncExternalStore(
    missionStore.subscribe,
    () => selector(missionStore.getState()),
    () => selector(missionStore.getServerState()),
  );
}
