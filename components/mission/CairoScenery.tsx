"use client";

import { useEffect, useMemo } from "react";
import { BufferGeometry, DoubleSide, Float32BufferAttribute, MeshStandardMaterial } from "three";
import { GeoBuilder } from "@/lib/geometryKit";
import { NILE_WORLD, NODE_BY_ID, type LandmarkKind } from "@/lib/mission/cairoMap";
import { ROAD_HALF, STREET } from "@/lib/mission/missionConfig";
import { routeToWorld, type Route, type RoutePoint } from "@/lib/mission/route";
import { createSignTexture } from "@/lib/textures";

/*
 * Real Cairo places along the trip: each graph node the route passes gets its
 * landmark (Cairo Tower's lattice shaft, Muhammad Ali mosque on the Citadel,
 * Al-Azhar's minarets, the pink Egyptian Museum, Maspero's round tower…),
 * built from primitives in a local frame where -x faces the road and z runs
 * along it. Plus the Nile with Gezira island and railings on the bridges.
 */

const SIDEWALK_OUT = ROAD_HALF + STREET.sidewalk;
const SET_BACK = 8;
const tmp: RoutePoint = { x: 0, z: 0, h: 0 };

type B = GeoBuilder;

/** Rows of dark window bands on the road-facing wall (x = face). */
function windows(b: B, face: number, h: number, len: number, z = 0, from = 2.4) {
  for (let y = from; y < h - 1; y += 3) b.box(0.12, 1.1, len * 0.9, face - 0.06, y, z, "#36414d");
}

function palm(b: B, x: number, z: number, h = 8) {
  b.cyl(0.16, 0.26, h, x, h / 2, z, "#7a5a3a", { segments: 6 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    b.box(0.45, 0.08, 3, x + Math.sin(a) * 1.2, h - 0.1, z + Math.cos(a) * 1.2, "#3f7a2e", { rot: [0.45 * Math.cos(a), a, -0.45 * Math.sin(a)] });
  }
}

function minaret(b: B, x: number, z: number, h: number, color: string, r = 0.9) {
  b.cyl(r * 0.8, r, h * 0.62, x, h * 0.31, z, color, { segments: 8 });
  b.cyl(r * 1.45, r * 1.45, 0.35, x, h * 0.62, z, color, { segments: 10 });
  b.cyl(r * 0.6, r * 0.7, h * 0.24, x, h * 0.74, z, color, { segments: 8 });
  b.cyl(r * 1.05, r * 1.05, 0.3, x, h * 0.86, z, color, { segments: 10 });
  b.cyl(0, r * 0.65, h * 0.14, x, h * 0.93, z, color, { segments: 8 });
}

function mosque(b: B, dome: string, stone: string, minarets: [number, number][], size = 1) {
  b.box(14 * size, 5, 22 * size, 4, 2.5, 0, stone);
  b.box(14.4 * size, 0.6, 22.4 * size, 4, 5.3, 0, "#c9b48a");
  b.cyl(3 * size, 3 * size, 1.6, 4, 6.4, 0, stone, { segments: 18 });
  b.sphere(3 * size, 4, 7.2, 0, dome, { w: 18, h: 10 });
  b.cyl(0, 0.25, 1.4, 4, 7.2 + 3 * size + 0.5, 0, "#c9a24a", { segments: 6 });
  for (let i = -2; i <= 2; i++) b.box(0.3, 3, 2.2, -3 * size - 0.05 + 4 - 4 * size, 1.5, i * 4 * size, "#4a3a2a");
  for (const [mx, mz] of minarets) minaret(b, mx, mz, 19 * size, stone);
}

export function buildLandmark(kind: LandmarkKind): { geo: BufferGeometry; signY: number } {
  const b = new GeoBuilder();
  const stone = "#d9c7a2";
  let signY = 6.4;
  switch (kind) {
    case "tahrir": {
      // Round garden with the obelisk, and the long Mogamma block behind it.
      b.cyl(8.5, 8.5, 0.35, 1, 0.18, 0, "#c9bfa6", { segments: 28 });
      b.cyl(7.6, 7.6, 0.5, 1, 0.25, 0, "#5f8a3a", { segments: 28 });
      b.box(2.6, 0.8, 2.6, 1, 0.9, 0, "#bfb196");
      b.box(1.3, 14, 1.3, 1, 8.2, 0, "#b58f5c", { taperX: 0.55, taperZ: 0.55 });
      b.cyl(0, 0.6, 1.2, 1, 15.8, 0, "#c9a24a", { segments: 4, rot: [0, Math.PI / 4, 0] });
      b.box(10, 24, 44, 17, 12, 0, "#d6c9ad");
      windows(b, 12, 24, 44);
      for (let z = -20; z <= 20; z += 5) b.box(0.4, 24, 0.5, 11.8, 12, z, "#c4b597");
      break;
    }
    case "museum": {
      // The Egyptian Museum: salmon-pink neoclassical facade with an arched portal.
      b.box(12, 11, 36, 4, 5.5, 0, "#c98a6e");
      b.box(12.4, 0.8, 36.4, 4, 11.4, 0, "#b5745a");
      b.box(2.4, 13, 10, -2.6, 6.5, 0, "#b5745a");
      b.box(0.3, 7, 4.4, -3.85, 3.5, 0, "#3a2a22");
      b.cyl(2.2, 2.2, 0.3, -3.9, 7, 0, "#3a2a22", { rot: [0, 0, Math.PI / 2], segments: 16 });
      for (const z of [-12, -6, 6, 12]) b.box(0.25, 2.2, 1.6, -2.05, 6, z, "#7a4a38");
      palm(b, -5, -14);
      palm(b, -5, 14);
      signY = 7.2;
      break;
    }
    case "station": {
      // Ramses Station: long arcaded Islamic-revival facade with a clock.
      b.box(14, 12, 40, 4, 6, 0, stone);
      for (let i = -3; i <= 3; i++) b.box(0.3, 6, 4.2, -3.05, 3, i * 5.6, "#3a2f26");
      b.box(15, 1, 41, 4, 12.4, 0, "#c4b28c");
      b.box(5, 6, 5, 4, 15.5, 0, stone);
      b.cyl(1.6, 1.6, 0.3, 1.4, 15.5, 0, "#f4f1ea", { rot: [0, 0, Math.PI / 2], segments: 18 });
      for (const z of [-17, 17]) minaret(b, 2, z, 18, stone, 0.7);
      signY = 13.6;
      break;
    }
    case "maspero": {
      // The round Radio & TV building with its tall slab tower.
      b.cyl(10, 10, 12, 6, 6, 0, "#dcd6c8", { segments: 32 });
      for (let y = 2.5; y < 12; y += 3) b.cyl(10.08, 10.08, 1.1, 6, y, 0, "#3b4552", { segments: 32 });
      b.box(8, 44, 7, 9, 22, 0, "#cfc8b8");
      windows(b, 5, 44, 7);
      b.cyl(0.25, 0.25, 10, 9, 49, 0, "#8a8f94", { segments: 6 });
      break;
    }
    case "statue": {
      // Talaat Harb in his tarboosh on a round plinth, classic Khedivial blocks behind.
      b.cyl(3.4, 3.8, 0.6, 0, 0.3, 0, "#cfc3a8", { segments: 20 });
      b.box(1.8, 2.8, 1.8, 0, 2, 0, "#bdb196");
      b.box(0.8, 1.7, 0.55, 0, 4.25, 0, "#3d4a3f");
      b.sphere(0.3, 0, 5.4, 0, "#3d4a3f", { w: 10, h: 8 });
      b.cyl(0.22, 0.26, 0.34, 0, 5.8, 0, "#8a1f1a", { segments: 10 });
      b.box(11, 18, 34, 12, 9, 0, "#e6d6b0");
      windows(b, 6.5, 18, 34);
      b.cyl(3, 3, 5, 7.5, 20.5, 14, "#e6d6b0", { segments: 14 });
      b.sphere(3, 7.5, 23, 14, "#8f9a8a", { w: 14, h: 8 });
      break;
    }
    case "market": {
      // Ataba: rows of stalls with striped awnings and produce.
      const awnings = ["#c8231e", "#18a39a", "#f6c21c", "#2f6fd6"];
      for (let i = 0; i < 4; i++) {
        const z = -9 + i * 6;
        b.box(3, 1, 4.6, -1, 0.5, z, "#6b4426");
        b.box(3.6, 0.1, 5.2, -1.2, 2.6, z, awnings[i], { rot: [0, 0, -0.2] });
        const produce = ["#e8762c", "#3d7a2e", "#d2302a"];
        [-1.4, 0, 1.4].forEach((pz, j) => b.sphere(0.35, -1, 1.25, z + pz, produce[(i + j) % 3], { w: 8, h: 6 }));
        for (const sz of [-1, 1]) b.box(0.12, 2.6, 0.12, 0.6, 1.3, z + sz * 2.4, "#4a3020");
      }
      b.box(9, 14, 30, 9, 7, 0, "#c9b07e");
      windows(b, 4.5, 14, 30);
      break;
    }
    case "mosque": {
      // Al-Azhar & Al-Hussein: domes and several Mamluk minarets.
      mosque(b, "#cdb184", stone, [
        [-1.5, -9],
        [-1.5, 9],
        [10, -7],
      ]);
      break;
    }
    case "sayeda": {
      // Sayeda Zeinab mosque: green dome, one tall minaret.
      mosque(b, "#2f7d4a", "#e4dcc8", [[-1, -8]], 0.85);
      break;
    }
    case "citadel": {
      // Salah El-Din's Citadel on its hill, crowned by Muhammad Ali mosque
      // (big grey dome, half domes, two pencil minarets).
      b.box(26, 7, 46, 12, 3.5, 0, "#b9a27a");
      b.box(1.6, 4.5, 46, -0.2, 9.2, 0, "#cbb48a");
      for (let z = -22; z <= 22; z += 2.2) b.box(1.7, 0.9, 1.1, -0.2, 11.9, z, "#cbb48a");
      for (const z of [-23, 23]) b.cyl(2.4, 2.6, 7, -0.2, 10.5, z, "#c4ab80", { segments: 14 });
      b.box(14, 8, 16, 12, 11, 0, "#ddd6c6");
      b.cyl(5.4, 5.4, 2.4, 12, 16.2, 0, "#ddd6c6", { segments: 24 });
      b.sphere(5.4, 12, 17.4, 0, "#97a1a8", { w: 24, h: 12 });
      for (const [dx, dz] of [
        [-5, 0],
        [5, 0],
        [0, -5],
        [0, 5],
      ])
        b.sphere(2.8, 12 + dx, 15, dz, "#97a1a8", { w: 14, h: 8 });
      for (const z of [-7.5, 7.5]) {
        b.cyl(0.55, 0.65, 30, 6.5, 22, z, "#ddd6c6", { segments: 8 });
        b.cyl(1, 1, 0.35, 6.5, 30, z, "#ddd6c6", { segments: 10 });
        b.cyl(0, 0.6, 3.6, 6.5, 38.8, z, "#97a1a8", { segments: 8 });
      }
      signY = 6.4;
      break;
    }
    case "palace": {
      // Abdeen Palace: long cream facade, colonnade and central pediment.
      b.box(12, 12, 56, 5, 6, 0, "#ece3cf");
      b.box(12.6, 0.8, 56.6, 5, 12.4, 0, "#d9ccb0");
      for (let z = -26; z <= 26; z += 2.6) b.cyl(0.32, 0.32, 9, -1.4, 4.5, z, "#f4efe2", { segments: 8 });
      b.box(2, 3.2, 14, -0.6, 14.2, 0, "#ece3cf", { taperZ: 0.15 });
      windows(b, -1, 12, 56, 0, 3);
      b.cyl(0.08, 0.08, 6, 5, 18, 0, "#666", { segments: 6 });
      b.box(0.05, 1.2, 2, 5, 20.4, 1, "#c8231e");
      break;
    }
    case "opera": {
      // Cairo Opera House: white Islamic-modern block with domes and arches.
      b.box(16, 10, 28, 6, 5, 0, "#f2efe8");
      for (let i = -2; i <= 2; i++) b.box(0.3, 6, 3.4, -2.05, 3, i * 5, "#4a5560");
      b.cyl(5.4, 5.4, 2, 6, 11, 0, "#f2efe8", { segments: 24 });
      b.sphere(5.4, 6, 12, 0, "#fbfaf6", { w: 24, h: 12 });
      for (const z of [-10, 10]) b.sphere(2.6, 6, 10.4, z, "#fbfaf6", { w: 16, h: 8 });
      palm(b, -4.5, -12);
      palm(b, -4.5, 12);
      break;
    }
    case "tower": {
      // Cairo Tower: lattice-wrapped concrete shaft (lotus), round pod on top.
      b.cyl(7, 7, 0.4, 3, 0.2, 0, "#5f8a3a", { segments: 24 });
      b.box(6, 4, 6, 3, 2, 0, "#c9b99a");
      const segs = 13;
      for (let i = 0; i < segs; i++) {
        const k = i / segs;
        const r0 = 2.7 - k * 0.7;
        const r1 = 2.7 - (k + 1 / segs) * 0.7;
        b.cyl(r1, r0, 4.2, 3, 4 + i * 4.2 + 2.1, 0, i % 2 ? "#a88d63" : "#8a7552", { segments: 14 });
      }
      const top = 4 + segs * 4.2;
      b.cyl(3.4, 2.4, 3, 3, top + 1.5, 0, "#cfc4a8", { segments: 18 });
      b.cyl(3.6, 3.6, 2.4, 3, top + 4.2, 0, "#3b4552", { segments: 18 });
      b.cyl(1, 3.6, 1.6, 3, top + 6.2, 0, "#cfc4a8", { segments: 18 });
      b.cyl(0.15, 0.2, 9, 3, top + 11.5, 0, "#6a6a6a", { segments: 6 });
      signY = 6.4;
      break;
    }
    case "hospital": {
      // Qasr El-Ainy: a big hospital block.
      b.box(14, 20, 46, 7, 10, 0, "#e8e2d6");
      windows(b, 0, 20, 46);
      b.box(0.4, 2.4, 2.4, -0.2, 17, 0, "#c8231e");
      b.box(0.5, 0.6, 1.6, -0.3, 17, 0, "#ffffff");
      b.box(0.5, 1.6, 0.6, -0.3, 17, 0, "#ffffff");
      break;
    }
    case "metro": {
      // Metro entrance canopy with stairs going down, the red "M" disc.
      b.box(4, 0.25, 6, 0, 3.2, 0, "#2a2a2a");
      for (const sz of [-1, 1]) b.box(0.2, 3.2, 0.2, -1.8, 1.6, sz * 2.8, "#8a918c");
      for (let i = 0; i < 6; i++) b.box(3.4, 0.2, 0.6, 0.2 + i * 0.1, 0.1 - i * 0.05, -2 + i * 0.7, "#6d6a65");
      b.cyl(0.08, 0.08, 5, 2.4, 2.5, 3.6, "#8a918c", { segments: 6 });
      b.cyl(0.8, 0.8, 0.15, 2.4, 5.4, 3.6, "#c8231e", { rot: [0, 0, Math.PI / 2], segments: 18 });
      break;
    }
    default: {
      // Zamalek: palm-lined avenue in front of a villa.
      b.box(4, 0.4, 26, 0, 0.2, 0, "#7a8a4a");
      for (let i = -2; i <= 2; i++) palm(b, 0, i * 6, 9);
      b.box(10, 9, 16, 10, 4.5, 0, "#efe1c4");
      b.box(10.6, 0.6, 16.6, 10, 9.3, 0, "#b5745a");
    }
  }
  return { geo: b.build(), signY };
}

/** Where each landmark of a route stands: past the corner, alternating sides. */
export function landmarkSpots(route: Route) {
  return route.nodes
    .map((n, i) => {
      const isDest = n.id === route.destination && i === route.nodes.findIndex((m) => m.id === route.destination);
      const s = isDest ? route.dropS : Math.min(route.length + 40, n.s + 26);
      const side: 1 | -1 = isDest ? 1 : i % 2 ? -1 : 1;
      return { id: n.id, s, side, dest: isDest };
    })
    .filter((spot) => spot.s > -60 && !route.wet[Math.max(0, Math.min(route.length, Math.round(spot.s)))]);
}

function Landmark({ route, id, s, side }: { route: Route; id: string; s: number; side: 1 | -1 }) {
  const node = NODE_BY_ID.get(id)!;
  const res = useMemo(() => {
    const { geo, signY } = buildLandmark(node.kind);
    const signTex = createSignTexture({
      bg: node.kind === "metro" ? "#c8231e" : node.kind === "market" ? "#f6c21c" : "#0b6b3a",
      border: "#ffffff",
      title: node.name,
      titleColor: node.kind === "market" ? "#1a1a1a" : "#ffffff",
      display: true,
    });
    return { geo, signY, signTex, mat: new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }) };
  }, [node]);
  useEffect(
    () => () => {
      res.geo.dispose();
      res.signTex.dispose();
      res.mat.dispose();
    },
    [res],
  );
  const place = useMemo(() => {
    routeToWorld(route, s, side * (SIDEWALK_OUT + SET_BACK), tmp);
    return { x: tmp.x, z: tmp.z, h: tmp.h + (side < 0 ? Math.PI : 0) };
  }, [route, s, side]);
  const signY = res.signY;
  return (
    <group position={[place.x, STREET.curbHeight, place.z]} rotation={[0, place.h, 0]}>
      <mesh geometry={res.geo} material={res.mat} castShadow receiveShadow />
      {/* Sign faces the road: plane normal -x */}
      <mesh position={[-7.4, signY, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[9, 4.5]} />
        <meshStandardMaterial map={res.signTex} roughness={0.5} emissive="#ffffff" emissiveMap={res.signTex} emissiveIntensity={0.2} side={DoubleSide} />
      </mesh>
      {[-3.6, 3.6].map((z) => (
        <mesh key={z} position={[-7.25, (signY - 2.25) / 2, z]}>
          <boxGeometry args={[0.22, signY - 2.25, 0.22]} />
          <meshStandardMaterial color="#5b605d" metalness={0.4} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

export function Landmarks({ route }: { route: Route }) {
  const spots = useMemo(() => landmarkSpots(route), [route]);
  return (
    <>
      {spots.map((p) => (
        <Landmark key={`${p.id}-${p.s}`} route={route} id={p.id} s={p.s} side={p.side} />
      ))}
    </>
  );
}

/** The Nile: both channels around Gezira, at their real positions and widths. */
export function Nile() {
  const geo = useMemo(() => {
    const pos: number[] = [];
    const idx: number[] = [];
    for (const c of NILE_WORLD) {
      const base = pos.length / 3;
      const pts = c.points;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const l = Math.hypot(dx, dz);
        const nx = -dz / l;
        const nz = dx / l;
        pos.push(pts[i].x + nx * c.half, -0.32, pts[i].z + nz * c.half, pts[i].x - nx * c.half, -0.32, pts[i].z - nz * c.half);
        if (i > 0) {
          const k = base + (i - 1) * 2;
          idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color="#3d7d96" roughness={0.18} metalness={0.25} side={DoubleSide} />
    </mesh>
  );
}

/** Railings + deck edge wherever the road crosses the river. */
export function BridgeRails({ route }: { route: Route }) {
  const geo = useMemo(() => {
    const b = new GeoBuilder();
    for (let s = 0; s <= route.length; s += 2.5) {
      if (!route.wet[Math.round(s)]) continue;
      for (const side of [1, -1]) {
        routeToWorld(route, s, side * (SIDEWALK_OUT - 0.15), tmp);
        b.box(0.18, 1.1, 0.18, tmp.x, STREET.curbHeight + 0.55, tmp.z, "#4a5d6a");
        // Top rail segment along the road.
        b.box(0.12, 0.12, 2.6, tmp.x, STREET.curbHeight + 1.1, tmp.z, "#6d8796", { rot: [0, tmp.h, 0] });
        // Deck fascia below the sidewalk edge.
        b.box(0.5, 1.4, 2.6, tmp.x, -0.6, tmp.z, "#8d8678", { rot: [0, tmp.h, 0] });
      }
    }
    return b.build();
  }, [route]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial vertexColors roughness={0.6} metalness={0.3} />
    </mesh>
  );
}
