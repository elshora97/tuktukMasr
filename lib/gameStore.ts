import {
  CLOSE_CALL_MESSAGES,
  GAME_OVER_MESSAGES,
  LABELS,
  OVERTAKE_MESSAGES,
  SCORE,
  SPEED,
  laneCenter,
  STORAGE_KEYS,
} from "./gameConfig";

export type GameStatus = "menu" | "playing" | "paused" | "gameOver";
export type Quality = "high" | "low";

export interface FloatingLabel {
  id: number;
  text: string;
  sub: string;
  kind: "overtake" | "close";
  /** Screen position in percent of the game viewport. */
  x: number;
  y: number;
}

export interface GameUIState {
  status: GameStatus;
  score: number;
  best: number;
  isNewBest: boolean;
  overtakes: number;
  closeCalls: number;
  /** Increments on every (re)start so 3D systems can reset themselves. */
  runId: number;
  /** Game-over overlay appears after the crash animation has played. */
  showGameOver: boolean;
  gameOverMessage: string;
  labels: FloatingLabel[];
  sound: boolean;
  quality: Quality;
  showPads: boolean;
}

/** The tuk-tuk starts in lane 2 (menu traffic keeps that lane clear). */
const START_X = laneCenter(2);

/**
 * High-frequency state read and written by the render loop. Never triggers
 * React renders; HUD elements that need it poll on their own rAF.
 */
export const runtime = {
  playerX: START_X,
  targetX: START_X,
  /** -1..1 held steering from keyboard / on-screen pads. */
  keySteer: 0,
  padSteer: 0,
  speed: SPEED.menuCruise as number,
  distance: 0,
  time: 0,
  /** Seconds since crash (−1 while alive). */
  crashT: -1,
  crashX: 0,
  shake: 0,
  lastLabelAt: 0,
  /** Pulse 0..1 used for the overtake "whoosh" FOV kick. */
  boost: 0,
  /** Set when a horn is requested by the UI; consumed by the audio loop. */
  hornRequested: false,
  /** Dev/test only: disables collisions (used by the automated fairness test). */
  godMode: false,
};

function resetRuntime() {
  runtime.playerX = START_X;
  runtime.targetX = START_X;
  runtime.keySteer = 0;
  runtime.padSteer = 0;
  runtime.speed = SPEED.start;
  runtime.distance = 0;
  runtime.time = 0;
  runtime.crashT = -1;
  runtime.shake = 0;
  runtime.lastLabelAt = 0;
  runtime.boost = 0;
}

function readNumber(key: string): number {
  try {
    const v = Number(window.localStorage.getItem(key));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function readString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — ignore */
  }
}

function detectQuality(): Quality {
  if (typeof window === "undefined") return "high";
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 4;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  if (cores <= 4 || mem <= 3) return "low";
  if (coarse && cores <= 6) return "low";
  return "high";
}

const initialState: GameUIState = {
  status: "menu",
  score: 0,
  best: 0,
  isNewBest: false,
  overtakes: 0,
  closeCalls: 0,
  runId: 0,
  showGameOver: false,
  gameOverMessage: GAME_OVER_MESSAGES[0],
  labels: [],
  sound: true,
  quality: "high",
  showPads: false,
};

let state: GameUIState = initialState;
const listeners = new Set<() => void>();

function setState(patch: Partial<GameUIState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const gameStore = {
  getState: () => state,
  getServerState: () => initialState,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

let hydrated = false;
let labelId = 1;
const labelTimers = new Set<ReturnType<typeof setTimeout>>();
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

export const gameActions = {
  /** Load persisted preferences. Safe to call more than once. */
  hydrate() {
    if (hydrated || typeof window === "undefined") return;
    hydrated = true;
    const sound = readString(STORAGE_KEYS.sound);
    const quality = readString(STORAGE_KEYS.quality);
    const pads = readString(STORAGE_KEYS.pads);
    setState({
      best: readNumber(STORAGE_KEYS.best),
      sound: sound === null ? true : sound === "1",
      quality: quality === "high" || quality === "low" ? quality : detectQuality(),
      showPads: pads === "1",
    });
  },

  start() {
    resetRuntime();
    clearLabels();
    setState({
      status: "playing",
      score: 0,
      overtakes: 0,
      closeCalls: 0,
      isNewBest: false,
      showGameOver: false,
      labels: [],
      runId: state.runId + 1,
    });
  },

  pause() {
    if (state.status === "playing" && runtime.crashT < 0) setState({ status: "paused" });
  },

  resume() {
    if (state.status === "paused") setState({ status: "playing" });
  },

  togglePause() {
    if (state.status === "playing") gameActions.pause();
    else if (state.status === "paused") gameActions.resume();
  },

  /** Called by the render loop at the moment of impact. */
  crash() {
    if (state.status !== "playing") return;
    runtime.crashT = 0;
    runtime.crashX = runtime.playerX;
    runtime.shake = 1;
    const isNewBest = state.score > state.best;
    const best = Math.max(state.best, state.score);
    if (isNewBest) write(STORAGE_KEYS.best, String(best));
    clearLabels();
    setState({
      status: "gameOver",
      best,
      isNewBest,
      labels: [],
      showGameOver: false,
      gameOverMessage: pick(GAME_OVER_MESSAGES),
    });
  },

  revealGameOver() {
    if (state.status === "gameOver" && !state.showGameOver) setState({ showGameOver: true });
  },

  toMenu() {
    resetRuntime();
    runtime.speed = SPEED.menuCruise;
    clearLabels();
    setState({ status: "menu", showGameOver: false, labels: [], score: 0, runId: state.runId + 1 });
  },

  /** Award an overtake. Labels are throttled; points never are. */
  overtake(closeCall: boolean, screenX: number, screenY: number) {
    if (state.status !== "playing") return;
    const points = SCORE.overtake + (closeCall ? SCORE.closeCallBonus : 0);
    const patch: Partial<GameUIState> = {
      score: state.score + points,
      overtakes: state.overtakes + 1,
      closeCalls: state.closeCalls + (closeCall ? 1 : 0),
    };
    const now = performance.now();
    const canLabel =
      state.labels.length < LABELS.maxVisible && now - runtime.lastLabelAt > LABELS.minIntervalMs;
    if (canLabel || closeCall) {
      runtime.lastLabelAt = now;
      const kept = state.labels.length >= LABELS.maxVisible ? state.labels.slice(1) : state.labels;
      const label: FloatingLabel = {
        id: labelId++,
        text: closeCall ? pick(CLOSE_CALL_MESSAGES) : pick(OVERTAKE_MESSAGES),
        sub: `+${points} نقطة`,
        kind: closeCall ? "close" : "overtake",
        // Stagger so labels that overlap in time don't sit on top of each other.
        x: screenX + (Math.random() * 2 - 1) * 9,
        y: screenY - kept.length * 11,
      };
      patch.labels = [...kept, label];
      const timer = setTimeout(() => {
        labelTimers.delete(timer);
        setState({ labels: state.labels.filter((l) => l.id !== label.id) });
      }, LABELS.lifetimeMs);
      labelTimers.add(timer);
    }
    setState(patch);
  },

  setSound(sound: boolean) {
    write(STORAGE_KEYS.sound, sound ? "1" : "0");
    setState({ sound });
  },

  setQuality(quality: Quality) {
    write(STORAGE_KEYS.quality, quality);
    setState({ quality });
  },

  setShowPads(showPads: boolean) {
    write(STORAGE_KEYS.pads, showPads ? "1" : "0");
    setState({ showPads });
  },

  horn() {
    runtime.hornRequested = true;
  },
};

function clearLabels() {
  labelTimers.forEach((t) => clearTimeout(t));
  labelTimers.clear();
}
