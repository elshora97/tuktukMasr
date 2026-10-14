/**
 * Downtown Cairo for "وصلني يا معلم": real places at their real coordinates
 * (lat/lon), linked by the real streets and Nile bridges between them.
 *
 * Positions are projected to meters around ميدان التحرير and scaled down
 * (MAP_SCALE) so trips stay arcade-length while the layout — which place is
 * north/east of which, which bridge crosses where, Gezira island between the
 * two Nile channels — matches the city.
 *
 * World axes: +x = east, -z = north.
 */
import { seeded } from "../prng";

export const MAP_SCALE = 0.35;
const ORIGIN = { lat: 30.0444, lon: 31.2357 };
const M_PER_LAT = 111_000;
const M_PER_LON = 111_000 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export interface XZ {
  x: number;
  z: number;
}

export function project(lat: number, lon: number): XZ {
  return { x: (lon - ORIGIN.lon) * M_PER_LON * MAP_SCALE, z: -(lat - ORIGIN.lat) * M_PER_LAT * MAP_SCALE };
}

export type LandmarkKind =
  | "tahrir"
  | "museum"
  | "station"
  | "maspero"
  | "statue"
  | "market"
  | "mosque"
  | "sayeda"
  | "citadel"
  | "palace"
  | "opera"
  | "tower"
  | "hospital"
  | "avenue"
  | "metro";

export interface MapNode {
  id: string;
  name: string;
  kind: LandmarkKind;
  lat: number;
  lon: number;
}

export interface MapEdge {
  a: string;
  b: string;
  name: string;
  /** Intermediate points (lat, lon) from a to b. */
  via?: [number, number][];
  bridge?: boolean;
}

export const NODES: MapNode[] = [
  { id: "tahrir", name: "ميدان التحرير", kind: "tahrir", lat: 30.0444, lon: 31.2357 },
  { id: "museum", name: "المتحف المصري", kind: "museum", lat: 30.0478, lon: 31.2337 },
  { id: "maspero", name: "ماسبيرو", kind: "maspero", lat: 30.0535, lon: 31.2318 },
  { id: "ramses", name: "محطة رمسيس", kind: "station", lat: 30.0626, lon: 31.2466 },
  { id: "talaat", name: "ميدان طلعت حرب", kind: "statue", lat: 30.0486, lon: 31.24 },
  { id: "ataba", name: "العتبة", kind: "market", lat: 30.0523, lon: 31.2472 },
  { id: "azhar", name: "الأزهر والحسين", kind: "mosque", lat: 30.0457, lon: 31.2626 },
  { id: "citadel", name: "القلعة", kind: "citadel", lat: 30.0299, lon: 31.2611 },
  { id: "sayeda", name: "السيدة زينب", kind: "sayeda", lat: 30.0293, lon: 31.2425 },
  { id: "abdeen", name: "قصر عابدين", kind: "palace", lat: 30.043, lon: 31.2478 },
  { id: "qasrAiny", name: "القصر العيني", kind: "hospital", lat: 30.0335, lon: 31.2312 },
  { id: "opera", name: "دار الأوبرا", kind: "opera", lat: 30.0424, lon: 31.2244 },
  { id: "tower", name: "برج القاهرة", kind: "tower", lat: 30.0459, lon: 31.2243 },
  { id: "zamalek", name: "الزمالك", kind: "avenue", lat: 30.0612, lon: 31.2192 },
  { id: "dokki", name: "مترو الدقي", kind: "metro", lat: 30.0385, lon: 31.2117 },
];

export const EDGES: MapEdge[] = [
  { a: "tahrir", b: "museum", name: "ميدان التحرير" },
  { a: "museum", b: "maspero", name: "كورنيش النيل" },
  { a: "museum", b: "ramses", name: "شارع رمسيس", via: [[30.0548, 31.2398]] },
  { a: "maspero", b: "ataba", name: "شارع ٢٦ يوليو", via: [[30.0538, 31.2405]] },
  { a: "tahrir", b: "talaat", name: "شارع طلعت حرب" },
  { a: "talaat", b: "ataba", name: "شارع عبد الخالق ثروت" },
  { a: "ataba", b: "ramses", name: "شارع كلوت بك", via: [[30.0575, 31.2478]] },
  { a: "ataba", b: "azhar", name: "شارع الأزهر", via: [[30.0497, 31.2545]] },
  { a: "ataba", b: "abdeen", name: "شارع الجمهورية" },
  { a: "tahrir", b: "abdeen", name: "شارع التحرير", via: [[30.0436, 31.2425]] },
  { a: "abdeen", b: "sayeda", name: "شارع نوبار", via: [[30.0365, 31.2455]] },
  { a: "sayeda", b: "azhar", name: "شارع بورسعيد", via: [[30.0385, 31.2545]] },
  { a: "tahrir", b: "qasrAiny", name: "شارع القصر العيني", via: [[30.0395, 31.2338]] },
  { a: "qasrAiny", b: "sayeda", name: "شارع المبتديان", via: [[30.0318, 31.2375]] },
  { a: "sayeda", b: "citadel", name: "شارع الصليبة", via: [[30.0302, 31.2525]] },
  { a: "azhar", b: "citadel", name: "شارع صلاح سالم", via: [[30.0385, 31.2668]] },
  { a: "tahrir", b: "opera", name: "كوبري قصر النيل", bridge: true, via: [[30.0438, 31.2295]] },
  { a: "opera", b: "tower", name: "شارع الجزيرة" },
  { a: "tower", b: "zamalek", name: "شارع حسن صبري", via: [[30.0535, 31.2205]] },
  { a: "zamalek", b: "maspero", name: "كوبري ٢٦ يوليو", bridge: true, via: [[30.058, 31.2262]] },
  { a: "opera", b: "dokki", name: "كوبري الجلاء", bridge: true, via: [[30.0405, 31.2178]] },
  { a: "museum", b: "dokki", name: "كوبري ٦ أكتوبر", bridge: true, via: [[30.0502, 31.2285], [30.0478, 31.2165]] },
];

/** The Nile's two channels around Gezira (centerline lat/lon + real width in m). */
export const NILE: { points: [number, number][]; width: number }[] = [
  {
    // Main (eastern) channel along the Corniche.
    width: 290,
    points: [
      [30.015, 31.2305],
      [30.028, 31.2302],
      [30.038, 31.2292],
      [30.046, 31.229],
      [30.054, 31.2282],
      [30.062, 31.2262],
      [30.072, 31.2235],
    ],
  },
  {
    // Western channel (between Gezira and Dokki / Agouza).
    width: 150,
    points: [
      [30.028, 31.2215],
      [30.036, 31.2185],
      [30.044, 31.2168],
      [30.052, 31.2162],
      [30.06, 31.2152],
      [30.07, 31.2148],
    ],
  },
];

export const NODE_BY_ID = new Map(NODES.map((n) => [n.id, n]));
export const NODE_POS = new Map(NODES.map((n) => [n.id, project(n.lat, n.lon)]));

/** Nile channels in world space. */
export const NILE_WORLD = NILE.map((c) => ({ points: c.points.map(([la, lo]) => project(la, lo)), half: (c.width * MAP_SCALE) / 2 }));

/** Distance from (x, z) to the nearest river bank edge (negative = over water). */
export function riverDistance(x: number, z: number): number {
  let best = Infinity;
  for (const c of NILE_WORLD) {
    for (let i = 0; i < c.points.length - 1; i++) {
      const a = c.points[i];
      const b = c.points[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)));
      const d = Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)) - c.half;
      if (d < best) best = d;
    }
  }
  return best;
}

interface Adj {
  to: string;
  edge: MapEdge;
  /** Polyline from this node to `to`, excluding both ends. */
  via: XZ[];
  length: number;
}

const ADJ = new Map<string, Adj[]>();
for (const e of EDGES) {
  const via = (e.via ?? []).map(([la, lo]) => project(la, lo));
  const pts = [NODE_POS.get(e.a)!, ...via, NODE_POS.get(e.b)!];
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  const push = (from: string, to: string, v: XZ[]) => {
    if (!ADJ.has(from)) ADJ.set(from, []);
    ADJ.get(from)!.push({ to, edge: e, via: v, length });
  };
  push(e.a, e.b, via);
  push(e.b, e.a, [...via].reverse());
}

export function neighbors(id: string): Adj[] {
  return ADJ.get(id) ?? [];
}

function edgeBetween(a: string, b: string): Adj {
  return neighbors(a).find((n) => n.to === b)!;
}

/** Shortest path a → b (node ids), never using the directed step `banFrom → banTo`. */
function shortestPath(a: string, b: string, banFrom?: string, banTo?: string): { path: string[]; length: number } | null {
  const dist = new Map<string, number>([[a, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([a]);
  while (open.size) {
    let cur = "";
    let cd = Infinity;
    for (const id of open) {
      const d = dist.get(id)!;
      if (d < cd) {
        cd = d;
        cur = id;
      }
    }
    open.delete(cur);
    if (cur === b) break;
    for (const n of neighbors(cur)) {
      if (cur === banFrom && n.to === banTo) continue;
      const nd = cd + n.length;
      if (nd < (dist.get(n.to) ?? Infinity)) {
        dist.set(n.to, nd);
        prev.set(n.to, cur);
        open.add(n.to);
      }
    }
  }
  if (!dist.has(b)) return null;
  const path = [b];
  while (path[0] !== a) path.unshift(prev.get(path[0])!);
  return { path, length: dist.get(b)! };
}

/** Signed turn angle (rad) going p → q → r; |angle| near π is a U-turn. */
function turnAngle(p: XZ, q: XZ, r: XZ) {
  const a1 = Math.atan2(q.x - p.x, q.z - p.z);
  const a2 = Math.atan2(r.x - q.x, r.z - q.z);
  let d = a2 - a1;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Trip length by road (world meters) from the pickup street to the destination. */
const TRIP_MIN = 380;
const TRIP_MAX = 1150;

export interface TripPlan {
  /** Polyline in world space, starting at the tuk-tuk. */
  points: XZ[];
  /** Graph nodes on the polyline: index into points. */
  nodes: { id: string; index: number }[];
  /** Street name for each polyline segment i → i+1. */
  segStreet: string[];
  segBridge: boolean[];
  pickupEdge: { from: string; to: string };
  destination: string;
}

/**
 * A trip starting at `start` (heading toward node `ahead`, coming from
 * `behind`): the passenger waits on a street leaving `ahead`, the destination
 * is a real place 0.6–1.8 km (scaled) away by road, and the route continues
 * one street past it so the city doesn't end at the drop-off.
 */
export function planTrip(start: XZ, ahead: string, behind: string | null, startStreet: string, startBridge: boolean, seed: number, avoid?: string): TripPlan {
  const rnd = seeded(seed);
  const pos = (id: string) => NODE_POS.get(id)!;
  const back = behind ? pos(behind) : start;
  // Pickup street: any exit of `ahead` that isn't a U-turn.
  const exits = neighbors(ahead).filter((n) => n.to !== behind && Math.abs(turnAngle(back, pos(ahead), n.via[0] ?? pos(n.to))) < 2.6);
  const pickup = (exits.length ? exits : neighbors(ahead))[Math.floor(rnd() * (exits.length || neighbors(ahead).length))];
  // Destination: a place a sensible drive away, reached without turning back.
  const options: { id: string; path: string[] }[] = [];
  for (const n of NODES) {
    if (n.id === ahead || n.id === pickup.to || n.id === avoid) continue;
    const sp = shortestPath(pickup.to, n.id, pickup.to, ahead);
    if (!sp) continue;
    const total = sp.length + pickup.length;
    if (total >= TRIP_MIN && total <= TRIP_MAX) options.push({ id: n.id, path: sp.path });
  }
  if (!options.length) {
    // Nothing in range: take one of the nearest reachable places instead.
    const near: { id: string; path: string[]; length: number }[] = [];
    for (const n of NODES) {
      if (n.id === ahead || n.id === pickup.to) continue;
      const sp = shortestPath(pickup.to, n.id, pickup.to, ahead);
      if (sp && sp.length + pickup.length >= TRIP_MIN * 0.6) near.push({ id: n.id, ...sp });
    }
    near.sort((x, y) => x.length - y.length);
    options.push(...near.slice(0, 3));
  }
  const dest = options[Math.floor(rnd() * options.length)];
  const nodePath = [ahead, ...dest.path];
  // One more street past the destination, as straight as possible.
  const last = nodePath[nodePath.length - 2];
  const D = nodePath[nodePath.length - 1];
  const cont = neighbors(D)
    .filter((n) => n.to !== last)
    .sort((a, b) => Math.abs(turnAngle(pos(last), pos(D), a.via[0] ?? pos(a.to))) - Math.abs(turnAngle(pos(last), pos(D), b.via[0] ?? pos(b.to))))[0];
  if (cont) nodePath.push(cont.to);

  const points: XZ[] = [start];
  const nodes: TripPlan["nodes"] = [];
  const segStreet: string[] = [];
  const segBridge: boolean[] = [];
  const add = (p: XZ, street: string, bridge: boolean) => {
    const prev = points[points.length - 1];
    if (Math.hypot(p.x - prev.x, p.z - prev.z) < 1) return;
    points.push(p);
    segStreet.push(street);
    segBridge.push(bridge);
  };
  add(pos(ahead), startStreet, startBridge);
  nodes.push({ id: ahead, index: points.length - 1 });
  for (let i = 1; i < nodePath.length; i++) {
    const adj = edgeBetween(nodePath[i - 1], nodePath[i]);
    for (const v of adj.via) add(v, adj.edge.name, !!adj.edge.bridge);
    add(pos(nodePath[i]), adj.edge.name, !!adj.edge.bridge);
    nodes.push({ id: nodePath[i], index: points.length - 1 });
  }
  return { points, nodes, segStreet, segBridge, pickupEdge: { from: ahead, to: pickup.to }, destination: dest.id };
}

/** A starting spot for a new shift: partway along a random street, heading to a node. */
export function shiftStart(seed: number): { start: XZ; ahead: string; behind: string; street: string; bridge: boolean } {
  const rnd = seeded(seed);
  const streets = EDGES.filter((e) => !e.bridge);
  const e = streets[Math.floor(rnd() * streets.length)];
  const [behind, ahead] = rnd() < 0.5 ? [e.a, e.b] : [e.b, e.a];
  const adj = edgeBetween(ahead, behind);
  const toward = adj.via[0] ?? NODE_POS.get(behind)!;
  const a = NODE_POS.get(ahead)!;
  const len = Math.hypot(toward.x - a.x, toward.z - a.z);
  const k = Math.min(110, len * 0.7) / len;
  return { start: { x: a.x + (toward.x - a.x) * k, z: a.z + (toward.z - a.z) * k }, ahead, behind, street: e.name, bridge: false };
}
