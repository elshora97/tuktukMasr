import { MISSION, ROAD_HALF, destinationFor, streetLane, type Destination, type FailReason } from "./missionConfig";
import { buildRoute, routePoint, streetAt, type Route, type RoutePoint } from "./route";
import { planTrip, shiftStart } from "./cairoMap";
import { PASSENGERS } from "../passengerModels";

/**
 * Passenger-mission state machine, one fare at a time in an endless shift:
 *
 *   missionStart → approachingPassenger ⇄ pickupAvailable → boarding
 *     → passengerOnboard → navigating ⇄ arriving → droppingOff → completed
 *   (any active phase) → failed   [crash, timeout, missed passenger, missed drop-off]
 *   completed / failed → (next fare from where the tuk-tuk is) missionStart
 *   failed with no lives left → shiftOver
 *
 * High-frequency values (position, speed, hold timers) live in `mission`
 * (mutable, read by the render loop and rAF-driven HUD). React-facing state in
 * `missionStore` only changes on phase transitions.
 */
export type MissionPhase =
  | "missionStart"
  | "approachingPassenger"
  | "pickupAvailable"
  | "boarding"
  | "passengerOnboard"
  | "navigating"
  | "arriving"
  | "droppingOff"
  | "completed"
  | "failed"
  | "shiftOver";

export interface MissionResult {
  time: number;
  base: number;
  timeBonus: number;
  precisionBonus: number;
  total: number;
  isBest: boolean;
}

export interface MissionUIState {
  phase: MissionPhase;
  destination: Destination;
  passenger: number;
  /** Second passenger of a two-person fare, or -1. */
  passenger2: number;
  timeLimit: number;
  /** Shift: lives left, score and fares delivered so far. */
  lives: number;
  score: number;
  fares: number;
  fail: FailReason | null;
  result: MissionResult | null;
  best: number;
  trips: number;
  /** Increments per trip so 3D systems rebuild for the new route. */
  tripId: number;
}

/** Mutable per-frame mission data. */
export const mission = {
  route: null as Route | null,
  s: 0,
  d: 0,
  speed: 0,
  time: 0,
  /** Seconds spent in the current phase. */
  phaseT: 0,
  /** Seconds held stopped inside the current zone. */
  holdT: 0,
  /** Where the tuk-tuk stopped for pickup (s), for the precision bonus. */
  pickupStopS: 0,
  /** Where the tuk-tuk stopped for the drop-off (s). */
  dropStopS: 0,
  /** True when the tuk-tuk is inside the active (pickup/drop) zone. */
  inZone: false,
};

const tmpP: RoutePoint = { x: 0, z: 0, h: 0 };

const STORAGE = { best: "toktok-kobry:mission-best", trips: "toktok-kobry:mission-trips" };

function read(key: string) {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}
function write(key: string, v: number) {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    /* ignore */
  }
}

const initial: MissionUIState = {
  phase: "missionStart",
  destination: destinationFor("tahrir", 1, 0),
  passenger: 0,
  passenger2: -1,
  timeLimit: 120,
  lives: MISSION.lives,
  score: 0,
  fares: 0,
  fail: null,
  result: null,
  best: 0,
  trips: 0,
  tripId: 0,
};

let state = initial;
const listeners = new Set<() => void>();
function setState(patch: Partial<MissionUIState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const missionStore = {
  getState: () => state,
  getServerState: () => initial,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

// ---------------------------------------------------------------------------
// Pure zone checks (also used by tests).

/** Inside the curb-lane stretch next to the passenger. */
export function inPickupZone(s: number, d: number, passengerS: number) {
  return s >= passengerS - MISSION.pickupBefore && s <= passengerS + MISSION.pickupAfter && d >= streetLane(STREET_RIGHT) - 1.3;
}

/** Inside the lit drop-off box at the destination. */
export function inDropZone(s: number, d: number, dropS: number) {
  return Math.abs(s - dropS) <= MISSION.dropHalf && d >= streetLane(STREET_RIGHT) - 1.3;
}

export function isStopped(speed: number) {
  return speed < MISSION.stoppedSpeed;
}

const STREET_RIGHT = 2;
export const MAX_D = ROAD_HALF - 0.85;

// ---------------------------------------------------------------------------

/** Set up the next fare on a freshly planned route (keeps lane and speed). */
function startFare(route: Route, speed: number) {
  mission.route = route;
  mission.s = 0;
  mission.speed = speed;
  mission.time = 0;
  mission.phaseT = 0;
  mission.holdT = 0;
  mission.pickupStopS = 0;
  mission.dropStopS = 0;
  mission.inZone = false;
  const pick = (avoid: number[]) => {
    const free = PASSENGERS.map((_, i) => i).filter((i) => !avoid.includes(i));
    return free[Math.floor(Math.random() * free.length)];
  };
  const passenger = pick([state.passenger, state.passenger2]);
  const passenger2 = Math.random() < MISSION.groupChance ? pick([passenger]) : -1;
  const group = passenger2 >= 0 ? 2 : 1;
  setState({
    phase: "missionStart",
    destination: destinationFor(route.destination, group, Math.floor(Math.random() * 10)),
    passenger,
    passenger2,
    // Time limit covers the drive to the drop-off, not the extra street past it.
    timeLimit: Math.round(route.dropS / MISSION.timeLimitSpeed + MISSION.timeLimitSlack),
    fail: null,
    tripId: state.tripId + 1,
  });
}

export const missionActions = {
  /** Start a new shift: full lives, score 0, first fare somewhere in downtown Cairo. */
  newShift() {
    const seed = (Math.random() * 1e9) | 0;
    const st = shiftStart(seed);
    const route = buildRoute(planTrip(st.start, st.ahead, st.behind, st.street, st.bridge, seed + 1), seed);
    mission.d = streetLane(1);
    setState({ lives: MISSION.lives, score: 0, fares: 0, result: null, best: read(STORAGE.best), trips: read(STORAGE.trips) });
    startFare(route, MISSION.cruiseSpeed * 0.6);
  },

  /** Next fare, planned from wherever the tuk-tuk is now (same street, same heading). */
  nextFare() {
    const prev = mission.route;
    if (!prev) return missionActions.newShift();
    const s = mission.s;
    const i = prev.nodes.findIndex((n) => n.s > s + 15);
    const ahead = i >= 0 ? prev.nodes[i] : prev.nodes[prev.nodes.length - 1];
    const behind = i > 0 ? prev.nodes[i - 1].id : null;
    routePoint(prev, s, tmpP);
    const street = streetAt(prev, s);
    const seed = (Math.random() * 1e9) | 0;
    const plan = planTrip({ x: tmpP.x, z: tmpP.z }, ahead.id, behind, street?.name ?? "", street?.bridge ?? false, seed, prev.destination);
    startFare(buildRoute(plan, seed), mission.speed);
  },

  setPhase(phase: MissionPhase) {
    if (state.phase === phase) return;
    mission.phaseT = 0;
    mission.holdT = 0;
    setState({ phase });
  },

  fail(reason: FailReason) {
    if (!missionActive(state.phase)) return;
    mission.phaseT = 0;
    setState({ phase: "failed", fail: reason, lives: state.lives - 1 });
  },

  /** No lives left: the shift is over. */
  endShift() {
    mission.phaseT = 0;
    setState({ phase: "shiftOver" });
  },

  complete() {
    const timeLeft = Math.max(0, state.timeLimit - mission.time);
    const timeBonus = Math.round(timeLeft * MISSION.timeBonusPerSecond);
    const precisionBonus =
      mission.route && Math.abs(mission.pickupStopS - mission.route.passengerS) <= MISSION.precisePickupDistance ? MISSION.precisionBonus : 0;
    const base = Math.round(MISSION.baseScore * (state.passenger2 >= 0 ? MISSION.groupScoreMul : 1));
    const total = base + timeBonus + precisionBonus;
    const score = state.score + total;
    const isBest = score > state.best;
    const best = Math.max(score, state.best);
    const trips = state.trips + 1;
    write(STORAGE.best, best);
    write(STORAGE.trips, trips);
    mission.phaseT = 0;
    mission.dropStopS = mission.s;
    setState({
      phase: "completed",
      best,
      trips,
      score,
      fares: state.fares + 1,
      result: { time: mission.time, base, timeBonus, precisionBonus, total, isBest },
    });
  },
};

/** True while the mission is still being played (not finished). */
export function missionActive(phase: MissionPhase) {
  return phase !== "completed" && phase !== "failed" && phase !== "shiftOver";
}
