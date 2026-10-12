"use client";

import { useEffect, useSyncExternalStore } from "react";
import { gameActions, gameStore, type GameUIState } from "@/lib/gameStore";

/**
 * Subscribe to a slice of the game UI state. Components re-render only when
 * the selected value changes (by Object.is).
 */
export function useGameState<T>(selector: (s: GameUIState) => T): T {
  return useSyncExternalStore(
    gameStore.subscribe,
    () => selector(gameStore.getState()),
    () => selector(gameStore.getServerState()),
  );
}

/** Hydrates persisted settings (best score, sound, quality) once on mount. */
export function useHydrateGameState() {
  useEffect(() => {
    gameActions.hydrate();
  }, []);
}

export { gameActions };
