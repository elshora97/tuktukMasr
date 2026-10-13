import { DESTINATIONS, MISSION, ROAD_HALF, streetLane, type Destination, type FailReason } from "./missionConfig";
import { generateRoute, type Route } from "./route";
import { PASSENGERS } from "../passengerModels";

/**
 * Passenger-mission state machine:
 *
 *   missionStart → approachingPassenger ⇄ pickupAvailable → boarding
 *     → passengerOnboard → navigating ⇄ arriving → droppingOff → completed
 *   (any active phase) → failed   [crash, timeout, missed passenger, missed drop-off]
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
  | "failed";

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
  timeLimit: number;
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
  /** True when the tuk-tuk is inside the active (pickup/drop) zone. */
  inZone: false,
};

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
  destination: DESTINATIONS[0],
  passenger: 0,
  timeLimit: 120,
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

export const missionActions = {
  /** Start a fresh trip with a new route, passenger and destination. */
  newTrip() {
    const seed = (Math.random() * 1e9) | 0;
    const route = generateRoute(seed);
    mission.route = route;
    mission.s = 0;
    mission.d = streetLane(1);
    mission.speed = MISSION.cruiseSpeed * 0.6;
    mission.time = 0;
    mission.phaseT = 0;
    mission.holdT = 0;
    mission.pickupStopS = 0;
    mission.inZone = false;
    const destination = DESTINATIONS[Math.floor(Math.random() * DESTINATIONS.length)];
    setState({
      phase: "missionStart",
      destination,
      passenger: Math.floor(Math.random() * PASSENGERS.length),
      timeLimit: Math.round(route.length / MISSION.timeLimitSpeed + MISSION.timeLimitSlack),
      fail: null,
      result: null,
      best: read(STORAGE.best),
      trips: read(STORAGE.trips),
      tripId: state.tripId + 1,
    });
  },

  setPhase(phase: MissionPhase) {
    if (state.phase === phase) return;
    mission.phaseT = 0;
    mission.holdT = 0;
    setState({ phase });
  },

  fail(reason: FailReason) {
    if (state.phase === "completed" || state.phase === "failed") return;
    mission.phaseT = 0;
    setState({ phase: "failed", fail: reason });
  },

  complete() {
    const timeLeft = Math.max(0, state.timeLimit - mission.time);
    const timeBonus = Math.round(timeLeft * MISSION.timeBonusPerSecond);
    const precisionBonus =
      mission.route && Math.abs(mission.pickupStopS - mission.route.passengerS) <= MISSION.precisePickupDistance ? MISSION.precisionBonus : 0;
    const total = MISSION.baseScore + timeBonus + precisionBonus;
    const isBest = total > state.best;
    const best = Math.max(total, state.best);
    const trips = state.trips + 1;
    write(STORAGE.best, best);
    write(STORAGE.trips, trips);
    mission.phaseT = 0;
    setState({
      phase: "completed",
      best,
      trips,
      result: { time: mission.time, base: MISSION.baseScore, timeBonus, precisionBonus, total, isBest },
    });
  },
};

/** True while the mission is still being played (not finished). */
export function missionActive(phase: MissionPhase) {
  return phase !== "completed" && phase !== "failed";
}
