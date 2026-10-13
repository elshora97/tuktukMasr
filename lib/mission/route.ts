import { seeded } from "../prng";
import { MISSION } from "./missionConfig";

/**
 * A mission route: a centerline sampled every meter, built from straights and
 * circular-arc turns. Positions along it use (s, d): s = distance along the
 * route, d = lateral offset (+ = right of travel direction).
 *
 * Heading h follows the model convention: rotation.y = h, forward = (-sin h, -cos h).
 * Headings are kept within ±90° of the start so the street never doubles back
 * on itself.
 */
export interface RouteTurn {
  /** s where the turn arc starts / ends. */
  start: number;
  end: number;
  dir: "left" | "right";
  /** Absolute angle turned, radians. */
  angle: number;
}

export interface Route {
  seed: number;
  length: number;
  xs: Float32Array;
  zs: Float32Array;
  hs: Float32Array;
  turns: RouteTurn[];
  passengerS: number;
  dropS: number;
}

export interface RoutePoint {
  x: number;
  z: number;
  h: number;
}

const QUARTER = Math.PI / 4;

export function generateRoute(seed: number): Route {
  const rnd = seeded(seed);
  const xs: number[] = [];
  const zs: number[] = [];
  const hs: number[] = [];
  let x = 0;
  let z = 0;
  let h = 0;
  const push = () => {
    xs.push(x);
    zs.push(z);
    hs.push(h);
  };
  const straight = (len: number) => {
    for (let i = 0; i < len; i++) {
      x += -Math.sin(h);
      z += -Math.cos(h);
      push();
    }
  };
  const turns: RouteTurn[] = [];
  const arc = (angle: number) => {
    // angle > 0 = left turn (heading increases)
    const len = Math.round(Math.abs(angle) * MISSION.turnRadius);
    const start = xs.length - 1;
    const step = angle / len;
    for (let i = 0; i < len; i++) {
      h += step / 2;
      x += -Math.sin(h);
      z += -Math.cos(h);
      h += step / 2;
      push();
    }
    turns.push({ start, end: xs.length - 1, dir: angle > 0 ? "left" : "right", angle: Math.abs(angle) });
  };

  push();
  straight(MISSION.firstStraight);
  const nTurns = MISSION.turnsMin + Math.floor(rnd() * (MISSION.turnsMax - MISSION.turnsMin + 1));
  // Heading measured in quarter turns, kept within [-2, 2] (±90°).
  let q = 0;
  for (let t = 0; t < nTurns; t++) {
    const options: number[] = [];
    for (const delta of [-2, -1, 1, 2]) {
      const nq = q + delta;
      if (nq < -2 || nq > 2) continue;
      // Avoid two consecutive sideways runs in opposite directions.
      if (Math.abs(nq) === 2 && Math.abs(q) === 2) continue;
      options.push(delta);
    }
    // Prefer gentle 45° turns, and steer back toward "forward" when far off.
    const weighted = options.flatMap((d) => (Math.abs(d) === 1 ? [d, d] : [d]));
    let delta = weighted[Math.floor(rnd() * weighted.length)];
    if (Math.abs(q) === 2 && Math.sign(delta) === Math.sign(q)) delta = -Math.sign(q);
    q += delta;
    arc(delta * QUARTER);
    const seg = t === nTurns - 1 ? MISSION.finalStraight : MISSION.segmentMin + Math.floor(rnd() * (MISSION.segmentMax - MISSION.segmentMin));
    straight(seg);
  }
  const length = xs.length - 1;
  return {
    seed,
    length,
    xs: Float32Array.from(xs),
    zs: Float32Array.from(zs),
    hs: Float32Array.from(hs),
    turns,
    passengerS: MISSION.passengerS,
    dropS: length - MISSION.dropFromEnd,
  };
}

/**
 * Centerline point at distance s (linear interpolation between samples).
 * Outside [0, length] the road continues straight, so scenery can extend
 * past both ends of the mission.
 */
export function routePoint(route: Route, s: number, out: RoutePoint): RoutePoint {
  if (s < 0 || s > route.length) {
    const i = s < 0 ? 0 : route.length;
    const ds = s < 0 ? s : s - route.length;
    out.h = route.hs[i];
    out.x = route.xs[i] - Math.sin(out.h) * ds;
    out.z = route.zs[i] - Math.cos(out.h) * ds;
    return out;
  }
  const c = Math.min(route.length - 0.0001, s);
  const i = Math.floor(c);
  const f = c - i;
  out.x = route.xs[i] + (route.xs[i + 1] - route.xs[i]) * f;
  out.z = route.zs[i] + (route.zs[i + 1] - route.zs[i]) * f;
  // Headings never wrap (bounded to ±90°), so plain lerp is safe.
  out.h = route.hs[i] + (route.hs[i + 1] - route.hs[i]) * f;
  return out;
}

/** World position of (s, d): centerline + right vector × d. Right = (cos h, -sin h). */
export function routeToWorld(route: Route, s: number, d: number, out: RoutePoint): RoutePoint {
  routePoint(route, s, out);
  out.x += Math.cos(out.h) * d;
  out.z += -Math.sin(out.h) * d;
  return out;
}

/** Next turn whose arc hasn't finished yet, or null. */
export function nextTurn(route: Route, s: number): RouteTurn | null {
  for (const t of route.turns) if (t.end > s) return t;
  return null;
}
