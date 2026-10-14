import { MISSION } from "./missionConfig";
import { NODE_BY_ID, riverDistance, type TripPlan, type XZ } from "./cairoMap";

/**
 * A mission route: a centerline sampled every meter along real Cairo streets
 * (see cairoMap), with street corners rounded into circular arcs. Positions
 * along it use (s, d): s = distance along the route, d = lateral offset
 * (+ = right of travel direction).
 *
 * Heading h follows the model convention: rotation.y = h, forward = (-sin h, -cos h).
 * Headings are unwrapped (continuous), so interpolating them is always safe.
 */
export interface RouteTurn {
  /** s where the turn arc starts / ends. */
  start: number;
  end: number;
  dir: "left" | "right";
  /** Absolute angle turned, radians. */
  angle: number;
}

export interface RouteStreet {
  s0: number;
  s1: number;
  name: string;
  bridge: boolean;
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
  streets: RouteStreet[];
  /** Real places on the route (graph nodes) and where they are along it. */
  nodes: { id: string; s: number }[];
  destination: string;
  /** 1 where the road is over (or right next to) the Nile. */
  wet: Uint8Array;
}

export interface RoutePoint {
  x: number;
  z: number;
  h: number;
}

/** Turns gentler than this don't get a "turn left/right" hint. */
const HINT_ANGLE = 0.35;

export function buildRoute(plan: TripPlan, seed: number): Route {
  const pts = plan.points;
  const dx: number[] = [pts[0].x];
  const dz: number[] = [pts[0].z];
  const dl: number[] = [0];
  let len = 0;
  let cx = pts[0].x;
  let cz = pts[0].z;
  const push = (x: number, z: number) => {
    len += Math.hypot(x - cx, z - cz);
    cx = x;
    cz = z;
    dx.push(x);
    dz.push(z);
    dl.push(len);
  };
  const lineTo = (p: XZ) => {
    const L = Math.hypot(p.x - cx, p.z - cz);
    const n = Math.max(1, Math.ceil(L / 0.5));
    const x0 = cx;
    const z0 = cz;
    for (let k = 1; k <= n; k++) push(x0 + ((p.x - x0) * k) / n, z0 + ((p.z - z0) * k) / n);
  };
  const vertexS: number[] = [0];
  const arcs: { s0: number; s1: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const P = pts[i];
    if (i === pts.length - 1) {
      lineTo(P);
      vertexS[i] = len;
      break;
    }
    const inL = Math.hypot(P.x - cx, P.z - cz);
    const outL = Math.hypot(pts[i + 1].x - P.x, pts[i + 1].z - P.z);
    const ix = (P.x - cx) / inL;
    const iz = (P.z - cz) / inL;
    const ox = (pts[i + 1].x - P.x) / outL;
    const oz = (pts[i + 1].z - P.z) / outL;
    const theta = Math.atan2(ix * oz - iz * ox, ix * ox + iz * oz);
    if (Math.abs(theta) < 0.03) {
      lineTo(P);
      vertexS[i] = len;
      continue;
    }
    const tanH = Math.tan(Math.min(Math.abs(theta), 2.9) / 2);
    const R = Math.max(4, Math.min(MISSION.turnRadius, (0.48 * Math.min(inL, outL * 0.9)) / tanH));
    const T = R * tanH;
    lineTo({ x: P.x - ix * T, z: P.z - iz * T });
    const s0 = len;
    const arcLen = R * Math.abs(theta);
    const steps = Math.max(2, Math.ceil(arcLen / 0.25));
    const step = arcLen / steps;
    for (let k = 0; k < steps; k++) {
      const a = (theta * (k + 0.5)) / steps;
      const c = Math.cos(a);
      const s = Math.sin(a);
      push(cx + (ix * c - iz * s) * step, cz + (ix * s + iz * c) * step);
    }
    vertexS[i] = (s0 + len) / 2;
    if (Math.abs(theta) > HINT_ANGLE) arcs.push({ s0, s1: len });
  }

  // Resample every meter.
  const length = Math.floor(len);
  const xs = new Float32Array(length + 1);
  const zs = new Float32Array(length + 1);
  let j = 0;
  for (let s = 0; s <= length; s++) {
    while (j < dl.length - 2 && dl[j + 1] < s) j++;
    const f = (s - dl[j]) / Math.max(1e-6, dl[j + 1] - dl[j]);
    xs[s] = dx[j] + (dx[j + 1] - dx[j]) * f;
    zs[s] = dz[j] + (dz[j + 1] - dz[j]) * f;
  }
  const hs = new Float32Array(length + 1);
  for (let s = 0; s <= length; s++) {
    const a = Math.min(s, length - 1);
    let h = Math.atan2(-(xs[a + 1] - xs[a]), -(zs[a + 1] - zs[a]));
    if (s > 0) {
      while (h - hs[s - 1] > Math.PI) h -= Math.PI * 2;
      while (h - hs[s - 1] < -Math.PI) h += Math.PI * 2;
    }
    hs[s] = h;
  }
  const turns: RouteTurn[] = arcs.map(({ s0, s1 }) => {
    const a = Math.min(length, Math.round(s0));
    const b = Math.min(length, Math.round(s1));
    const dh = hs[b] - hs[a];
    return { start: s0, end: s1, dir: dh > 0 ? "left" : "right", angle: Math.abs(dh) };
  });

  const streets: RouteStreet[] = [];
  for (let i = 0; i < plan.segStreet.length; i++) {
    const s0 = vertexS[i];
    const s1 = vertexS[i + 1];
    const last = streets[streets.length - 1];
    if (last && last.name === plan.segStreet[i]) last.s1 = s1;
    else streets.push({ s0, s1, name: plan.segStreet[i], bridge: plan.segBridge[i] });
  }
  const nodes = plan.nodes.map((n) => ({ id: n.id, s: vertexS[n.index] }));
  const sOf = (id: string) => nodes.find((n) => n.id === id)!.s;
  const a = sOf(plan.pickupEdge.from);
  const b = sOf(plan.pickupEdge.to);
  const passengerS = Math.max(70, a + 40, Math.min(a + (b - a) * 0.5, b - 35));
  const destS = nodes.filter((n) => n.id === plan.destination).pop()!.s;
  const dropS = Math.max(passengerS + 160, destS - 32);

  const wet = new Uint8Array(length + 1);
  for (let s = 0; s <= length; s++) wet[s] = riverDistance(xs[s], zs[s]) < 8 ? 1 : 0;

  return { seed, length, xs, zs, hs, turns, passengerS, dropS, streets, nodes, destination: plan.destination, wet };
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

/** Street the route is on at s. */
export function streetAt(route: Route, s: number): RouteStreet | null {
  for (const st of route.streets) if (s < st.s1) return st;
  return route.streets[route.streets.length - 1] ?? null;
}

export function placeName(id: string) {
  return NODE_BY_ID.get(id)?.name ?? "";
}
