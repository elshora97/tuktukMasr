/**
 * Race rules + simulation shared by the browser and the authoritative race
 * server. No DOM / three.js imports: the server runs this file directly.
 *
 * Fairness model: every racer drives the same finite course. Traffic is
 * generated from the room's seed and *all* traffic moves at one common speed,
 * so the obstacle course is identical for everyone regardless of when they
 * reach it. Clients only send their steering position; the server integrates
 * each racer's progress, detects crashes and decides finishing order.
 */
import { LANES, PLAYER, VEHICLES, VEHICLE_TYPES, laneCenter, type VehicleType } from "../gameConfig";
import { seeded } from "../prng";

export const RACE = {
  /** Course length in meters. */
  distance: 2400,
  minPlayers: 2,
  maxPlayers: 6,
  countdownMs: 3600,
  tickHz: 20,
  /** Common traffic speed (m/s). */
  trafficSpeed: 11,
  startSpeed: 21,
  endSpeed: 36,
  /** Acceleration back up to race speed after a spin-out. */
  recoverAccel: 12,
  /** Seconds stopped after hitting a car, then seconds of invulnerability. */
  stunS: 1.3,
  ghostS: 1.4,
  /** After the first finisher, others get this long before results lock. */
  finishGraceS: 25,
  /** Hard cap on a race's duration. */
  maxRaceS: 300,
  roomIdLength: 5,
  reconnectGraceMs: 20000,
  roomIdleMs: 15 * 60 * 1000,
  nameMax: 16,
  /** Steering can't move faster than this (m/s) — server-side sanity clamp. */
  maxLateralSpeed: PLAYER.maxLateralSpeed * 1.35,
  /** Speed a racer restarts at after a spin-out — above traffic speed so the
   * cars just overtaken can't rear-end them once the invulnerability ends. */
  recoverSpeed: 17,
  /** Coins fill the nitro tank (seconds, capped); the player fires it with the
   * nitro button, burning the whole tank at nitroBoost × race speed. */
  coinNitroS: 0.5,
  nitroMaxS: 3,
  nitroBoost: 1.4,
  /** Deceleration back to normal speed when nitro runs out (m/s²). */
  nitroFade: 14,
  coinPickupS: 1.3,
  coinPickupX: 1.05,
} as const;

export const ROOM_ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_ID_RE = new RegExp(`^[${ROOM_ID_ALPHABET}]{${RACE.roomIdLength}}$`);

export function normalizeRoomId(raw: string) {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Strip control chars / markup-ish chars, collapse spaces, trim to length. */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, RACE.nameMax);
}

export function raceSpeedFor(d: number, distance: number) {
  const k = Math.min(1, Math.max(0, d / distance));
  return RACE.startSpeed + (RACE.endSpeed - RACE.startSpeed) * k;
}

// ---------------------------------------------------------------------------
// Deterministic traffic

export interface RaceCar {
  type: VehicleType;
  lane: number;
  /** Center position along the course at race time t = 0. */
  s0: number;
  x: number;
  halfW: number;
  halfL: number;
}

const ESCAPE = PLAYER.halfLength * 2 + 3.5;

/**
 * Rows of 1–2 cars with growing density; a car is only placed if at least one
 * lane stays open (with room for the tuk-tuk) around it. Because every car
 * moves at the same speed, this static check holds for the whole race.
 * Returned sorted by s0.
 */
export function generateRaceTraffic(seed: number, distance: number): RaceCar[] {
  const rnd = seeded(seed);
  const cars: RaceCar[] = [];
  let s = 95;
  while (s < distance + 220) {
    const progress = Math.min(1, s / distance);
    const perRow = rnd() < 0.25 + progress * 0.45 ? 2 : 1;
    const lanes = Array.from({ length: LANES.count }, (_, i) => i).sort(() => rnd() - 0.5);
    let placed = 0;
    for (const lane of lanes) {
      if (placed >= perRow) break;
      const type = VEHICLE_TYPES[Math.floor(rnd() * VEHICLE_TYPES.length)];
      const spec = VEHICLES[type];
      const cs = s + (rnd() - 0.5) * 6;
      // Would this complete a wall? Count lanes blocked near cs.
      const blocked = new Set<number>([lane]);
      for (let i = cars.length - 1; i >= 0 && cars[i].s0 > cs - 40; i--) {
        const o = cars[i];
        if (Math.abs(o.s0 - cs) < o.halfL + spec.halfLength + ESCAPE) blocked.add(o.lane);
        if (o.lane === lane && Math.abs(o.s0 - cs) < o.halfL + spec.halfLength + 6) blocked.add(-1);
      }
      if (blocked.has(-1) || blocked.size >= LANES.count) continue;
      const wiggle = LANES.width / 2 - spec.halfWidth - 0.25;
      cars.push({
        type,
        lane,
        s0: cs,
        x: laneCenter(lane) + (rnd() * 2 - 1) * Math.max(0, wiggle) * 0.5,
        halfW: spec.halfWidth,
        halfL: spec.halfLength,
      });
      placed++;
    }
    const gap = 30 - progress * 13 + rnd() * 14;
    s += gap;
  }
  cars.sort((a, b) => a.s0 - b.s0);
  return cars;
}

// ---------------------------------------------------------------------------
// Deterministic coins (static on the road)

export interface RaceCoin {
  /** Position along the course. */
  s: number;
  x: number;
}

/**
 * Lines of 4–6 coins in one lane every ~70–110 m. Returned sorted by s. A
 * separate seed stream keeps traffic unchanged.
 */
export function generateRaceCoins(seed: number, distance: number): RaceCoin[] {
  const rnd = seeded(seed ^ 0x5f3759df);
  const coins: RaceCoin[] = [];
  let s = 60;
  while (s < distance - 30) {
    const lane = Math.floor(rnd() * LANES.count);
    const n = 4 + Math.floor(rnd() * 3);
    // Some lines drift into the next lane to make the player steer for them.
    const drift = rnd() < 0.35 ? (lane < LANES.count - 1 ? 1 : -1) : 0;
    for (let i = 0; i < n; i++) {
      const x = laneCenter(lane) + drift * LANES.width * (i / (n - 1));
      coins.push({ s: s + i * 4.5, x });
    }
    s += 70 + rnd() * 40;
  }
  return coins;
}

/** Index of the first car with s0 >= value (binary search). */
export function lowerBound(cars: RaceCar[], value: number) {
  let lo = 0;
  let hi = cars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cars[mid].s0 < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Racer simulation (identical on client prediction and server authority)

export interface RacerSim {
  d: number;
  x: number;
  speed: number;
  /** Seconds left stopped after a crash. */
  stun: number;
  /** Seconds left of invulnerability after a stun. */
  ghost: number;
  finished: boolean;
  /** Race time (s) when the finish line was crossed. */
  finishTime: number | null;
  hits: number;
  /** Seconds of nitro burning now. */
  nitro: number;
  /** Seconds of nitro stored, waiting for the button. */
  tank: number;
  coins: number;
  /** First coin not yet behind this racer, and collected indices at/after it. */
  coinIdx: number;
  got: number[];
}

export function makeRacer(): RacerSim {
  return { d: 0, x: laneCenter(1), speed: 0, stun: 0, ghost: 0, finished: false, finishTime: null, hits: 0, nitro: 0, tank: 0, coins: 0, coinIdx: 0, got: [] };
}

/** Player starting x for slot i (spread over lanes). */
export function startX(slot: number) {
  return laneCenter([1, 2, 0, 3, 1, 2][slot % 6]);
}

const HIT_SHRINK_SERVER = 0.06;

/**
 * Advance one racer by dt at race time t (seconds since the start).
 * Returns true when a crash happened during this step.
 */
export interface StepOptions {
  /** Grows (+) or shrinks (−) the crash box in meters. */
  hitMargin?: number;
  /** Pick up coins automatically (client prediction). The server instead
   * applies the client's reported pickups after validating them. */
  autoCoins?: boolean;
}

/**
 * Who decides what: the racer's own client detects its crashes and coin
 * pickups with the exact steering it rendered, and reports them; the server
 * validates each report against the course (with a small tolerance) and on
 * its own only catches deep, unmistakable hits (hitMargin < 0), so a client
 * can't skip crashes, and a near miss on screen is never a crash.
 */
export function stepRacer(
  r: RacerSim,
  x: number,
  dt: number,
  t: number,
  traffic: RaceCar[],
  distance: number,
  coins: RaceCoin[] = [],
  opts: StepOptions = {},
): boolean {
  r.x = x;
  if (r.stun > 0) {
    r.nitro = 0;
    r.stun -= dt;
    r.speed = 0;
    if (r.stun <= 0) {
      r.stun = 0;
      r.ghost = RACE.ghostS;
      r.speed = RACE.recoverSpeed;
    }
    return false;
  }
  if (r.ghost > 0) r.ghost = Math.max(0, r.ghost - dt);
  if (r.nitro > 0) r.nitro = Math.max(0, r.nitro - dt);
  const base = r.finished ? RACE.startSpeed : raceSpeedFor(r.d, distance);
  const target = r.nitro > 0 ? base * RACE.nitroBoost : base;
  const accel = r.nitro > 0 ? RACE.recoverAccel * 2.5 : RACE.recoverAccel;
  r.speed = r.speed < target ? Math.min(target, r.speed + accel * dt) : Math.max(target, r.speed - RACE.nitroFade * dt);
  const prev = r.d;
  r.d += r.speed * dt;
  if (!r.finished && r.d >= distance) {
    r.finished = true;
    const frac = r.speed > 0 ? (distance - prev) / (r.speed * dt) : 1;
    r.finishTime = t - dt + dt * Math.min(1, Math.max(0, frac));
  }
  if (!r.finished && opts.autoCoins !== false) collectCoins(r, coins);
  if (r.finished || r.ghost > 0) return false;
  if (!touchingCar(r, t, traffic, opts.hitMargin ?? 0)) return false;
  applyHit(r);
  return true;
}

/** Is the racer's crash box (grown/shrunk by margin) overlapping a car at race time t? */
export function touchingCar(r: RacerSim, t: number, traffic: RaceCar[], margin: number): boolean {
  // Traffic center at s0 + V t. Search cars near the player.
  const shift = RACE.trafficSpeed * t;
  const pHalfW = PLAYER.halfWidth - PLAYER.hitShrinkX - HIT_SHRINK_SERVER + margin;
  const pHalfL = PLAYER.halfLength - PLAYER.hitShrinkZ - HIT_SHRINK_SERVER + margin;
  for (let i = lowerBound(traffic, r.d - shift - 9); i < traffic.length; i++) {
    const c = traffic[i];
    const cs = c.s0 + shift;
    if (cs > r.d + 9) break;
    if (Math.abs(cs - r.d) < c.halfL * 0.94 + pHalfL && Math.abs(c.x - r.x) < c.halfW * 0.9 + pHalfW) return true;
  }
  return false;
}

/** Spin-out: stop, lose any burning nitro (the tank is kept). */
export function applyHit(r: RacerSim) {
  r.stun = RACE.stunS;
  r.speed = 0;
  r.nitro = 0;
  r.hits++;
}

/** Server: accept a reported coin pickup if that coin is really next to the racer. */
export function claimCoin(r: RacerSim, coins: RaceCoin[], i: number): boolean {
  const c = coins[i];
  if (!c || r.finished || r.got.includes(i) || i < r.coinIdx) return false;
  if (Math.abs(c.s - r.d) > RACE.coinPickupS + 3 || Math.abs(c.x - r.x) > RACE.coinPickupX + 0.6) return false;
  r.got.push(i);
  r.coins++;
  r.tank = Math.min(RACE.nitroMaxS, r.tank + RACE.coinNitroS);
  // Coins far behind can't be claimed any more; keep the list short.
  while (r.coinIdx < coins.length && coins[r.coinIdx].s < r.d - RACE.coinPickupS - 4) r.coinIdx++;
  r.got = r.got.filter((k) => k >= r.coinIdx);
  return true;
}

/** Picks up coins within reach; each one tops up nitro. */
function collectCoins(r: RacerSim, coins: RaceCoin[]) {
  const reach = RACE.coinPickupS;
  while (r.coinIdx < coins.length && coins[r.coinIdx].s < r.d - reach) r.coinIdx++;
  if (r.got.length && r.got[0] < r.coinIdx) r.got = r.got.filter((i) => i >= r.coinIdx);
  for (let i = r.coinIdx; i < coins.length && coins[i].s <= r.d + reach; i++) {
    if (Math.abs(coins[i].x - r.x) > RACE.coinPickupX || r.got.includes(i)) continue;
    r.got.push(i);
    r.coins++;
    r.tank = Math.min(RACE.nitroMaxS, r.tank + RACE.coinNitroS);
  }
}

/** Nitro button: burn the whole tank. Returns false when there's nothing to fire. */
export function fireNitro(r: RacerSim): boolean {
  if (r.tank <= 0 || r.stun > 0 || r.finished) return false;
  r.nitro += r.tank;
  r.tank = 0;
  return true;
}

/**
 * Online races are offered only when a race server URL is configured
 * (NEXT_PUBLIC_MULTIPLAYER_URL, baked in at build time). Without it the
 * race mode is hidden from the menu and invite links are ignored.
 */
export const RACE_ENABLED = Boolean(process.env.NEXT_PUBLIC_MULTIPLAYER_URL);
