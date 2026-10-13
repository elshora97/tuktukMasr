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
/** endless = original single player; race = online race; taxi = passenger missions. */
export type GameMode = "endless" | "race" | "taxi";
export type Quality = "high" | "low";

/** A close-overtake shout-out. Its on-screen position follows the passed car (see screenAnchors). */
export interface FloatingLabel {
  id: number;
  text: string;
  sub: string;
}

export interface GameUIState {
  status: GameStatus;
  mode: GameMode;
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
 * Everything a tuk-tuk needs to render itself. The player's pose lives in
 * runtime.pose and is written by whichever mode controller is active; remote
 * racers each own one too.
 */
export interface TukTukPose {
  x: number;
  z: number;
  /** Model yaw (rotation.y); 0 = facing -z. */
  heading: number;
  speed: number;
  /** Seconds since a crash (tip-over animation), −1 = none. */
  crashT: number;
  /** Seconds into a race spin-out, −1 = none. */
  spinT: number;
  /** >0 while invulnerable after a spin-out (renders flickering). */
  ghost: number;
  boost: number;
  /** Seated passenger variant, −1 = empty. */
  passenger: number;
}

export function makePose(): TukTukPose {
  return { x: START_X, z: 0, heading: 0, speed: 0, crashT: -1, spinT: -1, ghost: 0, boost: 0, passenger: -1 };
}

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
  /** Held brake (taxi mode): keyboard ↓/S or the on-screen pedal. */
  brake: false,
  pose: makePose(),
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
  runtime.brake = false;
  Object.assign(runtime.pose, makePose());
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
  mode: "endless",
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
      mode: "endless",
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
    // Online races cannot be paused (the server keeps simulating).
    if (state.status === "playing" && state.mode !== "race" && runtime.crashT < 0) setState({ status: "paused" });
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

  /** Back to the attract scene. `mode` picks which menu is shown (race = race lobby screens). */
  toMenu(mode: GameMode = "endless") {
    resetRuntime();
    runtime.speed = SPEED.menuCruise;
    clearLabels();
    setState({ status: "menu", mode, showGameOver: false, labels: [], score: 0, runId: state.runId + 1 });
  },

  /** Enter a non-endless mode's own flow (controllers watch runId to reset). */
  enterMode(mode: GameMode, status: GameStatus) {
    resetRuntime();
    clearLabels();
    setState({ mode, status, showGameOver: false, labels: [], score: 0, runId: state.runId + 1 });
  },

  setStatus(status: GameStatus) {
    if (state.status !== status) setState({ status });
  },

  /**
   * Award an overtake. Every pass scores; only close passes may get a label
   * (throttled by cooldown and max visible). Returns the new label id, or null.
   */
  overtake(closeCall: boolean): number | null {
    if (state.status !== "playing") return null;
    const points = SCORE.overtake + (closeCall ? SCORE.closeCallBonus : 0);
    const patch: Partial<GameUIState> = {
      score: state.score + points,
      overtakes: state.overtakes + 1,
      closeCalls: state.closeCalls + (closeCall ? 1 : 0),
    };
    let id: number | null = null;
    const now = performance.now();
    if (closeCall && state.labels.length < LABELS.maxVisible && now - runtime.lastLabelAt > LABELS.cooldownMs) {
      runtime.lastLabelAt = now;
      const label: FloatingLabel = {
        id: labelId++,
        text: pick(Math.random() < 0.5 ? CLOSE_CALL_MESSAGES : OVERTAKE_MESSAGES),
        sub: "+" + points,
      };
      id = label.id;
      patch.labels = [...state.labels, label];
      const timer = setTimeout(() => {
        labelTimers.delete(timer);
        gameActions.removeLabel(label.id);
      }, LABELS.lifetimeMs);
      labelTimers.add(timer);
    }
    setState(patch);
    return id;
  },

  removeLabel(id: number) {
    if (state.labels.some((l) => l.id === id)) setState({ labels: state.labels.filter((l) => l.id !== id) });
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
