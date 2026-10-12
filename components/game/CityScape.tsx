"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Quaternion,
  Euler,
  Vector3,
} from "three";
import { LAYOUT, ROAD } from "@/lib/gameConfig";
import { GeoBuilder, seeded } from "@/lib/geometryKit";
import { FACADE_TILE_H, FACADE_TILE_W, createBrickTexture, createFacadeTexture } from "@/lib/textures";
import { Scroll } from "./Scroll";

const GROUND_Y = -ROAD.deckHeight;
const CHUNK_LEN = 360;
const CHUNK_PERIOD = CHUNK_LEN * 2;
const CHUNK_MAX_Z = 400;
const NILE_X = 70;

const FACADE_COLORS = ["#e8d6b5", "#d9c09a", "#d6a873", "#d8b4a0", "#ece6da", "#e9d9a0", "#c99a74", "#bdb5a8", "#e3cfc0", "#cfc3a8"];

/** Building variants: [width, height, depth]. Window UVs tile to real size. */
const VARIANTS: [number, number, number][] = [
  [12, 18, 12],
  [10, 30, 13],
  [17, 12, 12],
];

function buildingGeometry(w: number, h: number, d: number) {
  const g = new BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  const uv = g.getAttribute("uv");
  const colors = new Float32Array(uv.count * 3);
  // Face order: px, nx, py, ny, pz, nz — 4 vertices each.
  for (let face = 0; face < 6; face++) {
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      const top = face === 2 || face === 3;
      if (top) {
        uv.setXY(i, 0.03, 0.97);
      } else {
        const span = face < 2 ? d : w;
        uv.setXY(i, uv.getX(i) * (span / FACADE_TILE_W), uv.getY(i) * (h / FACADE_TILE_H));
      }
      const shade = top ? 0.72 : 1;
      colors[i * 3] = shade;
      colors[i * 3 + 1] = shade;
      colors[i * 3 + 2] = shade;
    }
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return g;
}

function buildMosque() {
  const b = new GeoBuilder();
  const stone = "#d8c7a3";
  b.box(18, 9, 18, 0, 4.5, 0, stone);
  b.box(19, 0.8, 19, 0, 9.2, 0, "#c4b28c");
  b.cyl(5.2, 5.6, 2.5, 0, 10.6, 0, stone, { segments: 16 });
  b.sphere(5.2, 0, 11.8, 0, "#b9b2a0", { w: 16, h: 10 });
  b.cyl(0.08, 0.08, 2.4, 0, 18.2, 0, "#d4af37", { segments: 4 });
  for (const [x, z] of [
    [-7, -7],
    [7, -7],
  ]) {
    b.cyl(1.0, 1.25, 30, x, 15, z, stone, { segments: 10 });
    b.cyl(1.7, 1.2, 0.8, x, 20, z, "#c4b28c", { segments: 10 });
    b.cyl(1.5, 1.1, 0.7, x, 26, z, "#c4b28c", { segments: 10 });
    b.cyl(0.0, 1.05, 4, x, 32, z, "#9aa29a", { segments: 10 });
    b.cyl(0.06, 0.06, 1.6, x, 34.6, z, "#d4af37", { segments: 4 });
  }
  return b.build();
}

function buildFelucca() {
  const b = new GeoBuilder();
  b.box(1.6, 0.7, 6.5, 0, 0.35, 0, "#6b4426", { taperX: 1.2, taperZ: 1.1 });
  b.box(1.5, 0.08, 5.8, 0, 0.72, 0, "#c79a5b");
  b.cyl(0.08, 0.1, 7, 0, 4, -1, "#4a3020", { segments: 5 });
  // Big lateen sail (slanted)
  b.box(0.06, 9, 5.2, 0.2, 5.2, 0.3, "#f6f1e4", { taperZ: 0.04, shiftZ: -2.4, rot: [0.18, 0, 0] });
  return b.build();
}

interface ChunkLayout {
  buildings: { variant: number; m: Matrix4; color: Color; top: number; w: number; d: number; x: number; z: number }[];
  bricks: Matrix4[];
  tanks: Matrix4[];
  dishes: Matrix4[];
  mosques: Vector3[];
  boats: Matrix4[];
}

function layoutChunk(seed: number): ChunkLayout {
  const rnd = seeded(seed);
  const out: ChunkLayout = { buildings: [], bricks: [], tanks: [], dishes: [], mosques: [], boats: [] };
  const q = new Quaternion();
  const e = new Euler();
  const cell = 17;
  const rows = Math.floor(CHUNK_LEN / cell);
  const sides = [
    { from: LAYOUT.leftBarrierX - 10, to: -240, dir: -1 },
    { from: LAYOUT.rightBarrierX + 9, to: NILE_X - 8, dir: 1 },
  ];
  let mosqueBudget = 2;
  for (const side of sides) {
    const cols = Math.floor(Math.abs(side.to - side.from) / cell);
    for (let c = 0; c < cols; c++) {
      if (c % 4 === 3) continue; // street
      for (let r = 0; r < rows; r++) {
        if (r % 5 === 4) continue; // cross street
        if (rnd() < 0.1) continue;
        const x = side.from + side.dir * (c * cell + cell / 2) + (rnd() - 0.5) * 2.5;
        const z = -r * cell - cell / 2 + (rnd() - 0.5) * 2.5;
        if (mosqueBudget > 0 && c >= 2 && rnd() < 0.012) {
          mosqueBudget--;
          out.mosques.push(new Vector3(x, GROUND_Y, z));
          continue;
        }
        const near = c < 2;
        const variant = near ? (rnd() < 0.55 ? 1 : 0) : Math.floor(rnd() * 3);
        const [w, h, d] = VARIANTS[variant];
        const sxz = 0.85 + rnd() * 0.22;
        const sy = 0.8 + rnd() * 0.45;
        const m = new Matrix4();
        e.set(0, rnd() < 0.15 ? (rnd() - 0.5) * 0.3 : 0, 0);
        q.setFromEuler(e);
        m.compose(new Vector3(x, GROUND_Y, z), q, new Vector3(sxz, sy, sxz));
        const top = GROUND_Y + h * sy;
        const color = new Color(FACADE_COLORS[Math.floor(rnd() * FACADE_COLORS.length)]);
        out.buildings.push({ variant, m, color, top, w: w * sxz, d: d * sxz, x, z });
      }
    }
  }
  // Rooftop life: unfinished brick floors, water tanks, satellite dishes.
  for (const bld of out.buildings) {
    let roof = bld.top;
    if (rnd() < 0.38) {
      const m = new Matrix4();
      const bw = bld.w * (0.55 + rnd() * 0.35);
      const bd = bld.d * (0.55 + rnd() * 0.35);
      m.compose(
        new Vector3(bld.x + (rnd() - 0.5) * (bld.w - bw) * 0.8, roof, bld.z + (rnd() - 0.5) * (bld.d - bd) * 0.8),
        q.identity(),
        new Vector3(bw, 3, bd),
      );
      out.bricks.push(m);
      if (rnd() < 0.5) roof += 3;
    }
    const tanks = 1 + Math.floor(rnd() * 2);
    for (let t = 0; t < tanks; t++) {
      const m = new Matrix4();
      m.compose(new Vector3(bld.x + (rnd() - 0.5) * bld.w * 0.7, roof + 0.7, bld.z + (rnd() - 0.5) * bld.d * 0.7), q.identity(), new Vector3(1, 1, 1));
      out.tanks.push(m);
    }
    const dishes = 1 + Math.floor(rnd() * 4);
    for (let t = 0; t < dishes; t++) {
      const m = new Matrix4();
      e.set(-0.7 - rnd() * 0.3, rnd() * 0.6 - 0.3 + Math.PI * 0.85, 0);
      q.setFromEuler(e);
      const s = 0.8 + rnd() * 0.5;
      m.compose(new Vector3(bld.x + (rnd() - 0.5) * bld.w * 0.8, roof + 0.8, bld.z + (rnd() - 0.5) * bld.d * 0.8), q, new Vector3(s, s, s));
      out.dishes.push(m);
    }
  }
  // Feluccas on the Nile
  const boats = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < boats; i++) {
    const m = new Matrix4();
    e.set(0, rnd() * Math.PI * 2, 0);
    q.setFromEuler(e);
    m.compose(new Vector3(NILE_X + 25 + rnd() * 160, GROUND_Y + 0.2, -rnd() * CHUNK_LEN), q, new Vector3(1.3, 1.3, 1.3));
    out.boats.push(m);
  }
  return out;
}

function useMatrices(ref: React.RefObject<InstancedMesh | null>, matrices: Matrix4[], colors?: Color[]) {
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    matrices.forEach((mat, i) => m.setMatrixAt(i, mat));
    colors?.forEach((c, i) => m.setColorAt(i, c));
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [ref, matrices, colors]);
}

interface SharedCity {
  buildingGeos: BufferGeometry[];
  facadeMat: MeshStandardMaterial;
  brickGeo: BufferGeometry;
  brickMat: MeshStandardMaterial;
  tankGeo: BufferGeometry;
  dishGeo: BufferGeometry;
  propMat: MeshStandardMaterial;
  mosqueGeo: BufferGeometry;
  boatGeo: BufferGeometry;
}

function BuildingVariant({ geo, mat, items }: { geo: BufferGeometry; mat: MeshStandardMaterial; items: ChunkLayout["buildings"] }) {
  const ref = useRef<InstancedMesh>(null);
  const mats = useMemo(() => items.map((b) => b.m), [items]);
  const cols = useMemo(() => items.map((b) => b.color), [items]);
  useMatrices(ref, mats, cols);
  if (items.length === 0) return null;
  return <instancedMesh ref={ref} args={[geo, mat, items.length]} />;
}

function Props({ geo, mat, items }: { geo: BufferGeometry; mat: MeshStandardMaterial; items: Matrix4[] }) {
  const ref = useRef<InstancedMesh>(null);
  useMatrices(ref, items);
  if (items.length === 0) return null;
  return <instancedMesh ref={ref} args={[geo, mat, items.length]} />;
}

function Chunk({ seed, shared, dense }: { seed: number; shared: SharedCity; dense: boolean }) {
  const layout = useMemo(() => {
    const l = layoutChunk(seed);
    if (!dense) {
      // Low quality: thin out the far blocks and rooftop clutter.
      l.buildings = l.buildings.filter((b) => Math.abs(b.x) < 120);
      l.dishes = l.dishes.filter((_, i) => i % 2 === 0);
    }
    return l;
  }, [seed, dense]);
  const byVariant = useMemo(() => VARIANTS.map((_, v) => layout.buildings.filter((b) => b.variant === v)), [layout]);
  return (
    <group>
      {byVariant.map((items, v) => (
        <BuildingVariant key={v} geo={shared.buildingGeos[v]} mat={shared.facadeMat} items={items} />
      ))}
      <Props geo={shared.brickGeo} mat={shared.brickMat} items={layout.bricks} />
      <Props geo={shared.tankGeo} mat={shared.propMat} items={layout.tanks} />
      <Props geo={shared.dishGeo} mat={shared.propMat} items={layout.dishes} />
      <Props geo={shared.boatGeo} mat={shared.propMat} items={layout.boats} />
      {layout.mosques.map((p, i) => (
        <mesh key={i} geometry={shared.mosqueGeo} material={shared.propMat} position={p} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Distant skyline: static, fog-free silhouettes on the horizon.

const HAZE_C = new Color("#e6cda6");

function hazed(hex: string, k: number) {
  return new Color(hex).lerp(HAZE_C, k);
}

function DistantSkyline() {
  const ref = useRef<InstancedMesh>(null);
  const data = useMemo(() => {
    const rnd = seeded(99);
    const mats: Matrix4[] = [];
    const cols: Color[] = [];
    const q = new Quaternion();
    for (let i = 0; i < 260; i++) {
      const a = -Math.PI + rnd() * Math.PI; // front half (z < 0)
      const r = 520 + rnd() * 220;
      const x = Math.cos(a) * r * 1.2;
      const z = Math.sin(a) * r;
      // leave a gap across the Nile on the front-right for the tower view
      if (x > 120 && x < 330 && z > -620) continue;
      const w = 14 + rnd() * 26;
      const h = 14 + rnd() * 55 * (rnd() < 0.1 ? 2 : 1);
      q.setFromEuler(new Euler(0, -a + Math.PI / 2, 0));
      const m = new Matrix4().compose(new Vector3(x, GROUND_Y + h / 2, z), q, new Vector3(w, h, 12 + rnd() * 14));
      mats.push(m);
      cols.push(hazed(FACADE_COLORS[Math.floor(rnd() * FACADE_COLORS.length)], 0.55 + (r - 520) / 900));
    }
    return { mats, cols };
  }, []);
  useMatrices(ref, data.mats, data.cols);
  const landmarks = useMemo(() => {
    // Cairo Tower (lotus-topped lattice tower), Citadel mosque & minarets, Giza pyramids.
    const tower = new GeoBuilder();
    const tc = hazed("#b9a27e", 0.5);
    tower.cyl(4.2, 6, 125, 0, 62.5, 0, tc, { segments: 12 });
    tower.cyl(8, 4.4, 9, 0, 129, 0, tc, { segments: 12 });
    tower.cyl(6.5, 8, 4, 0, 135, 0, hazed("#8f7a5b", 0.5), { segments: 12 });
    tower.cyl(0.6, 1.2, 26, 0, 150, 0, hazed("#9e9e9e", 0.5), { segments: 6 });
    const citadel = new GeoBuilder();
    const cc = hazed("#c8b48e", 0.55);
    citadel.sphere(80, 0, -50, 0, hazed("#b59c77", 0.6), { w: 16, h: 8 });
    citadel.box(70, 22, 45, 0, 34, 0, cc);
    citadel.sphere(16, 0, 50, 0, cc, { w: 16, h: 10 });
    for (const sx of [-1, 1]) {
      citadel.sphere(8, sx * 16, 46, 0, cc, { w: 12, h: 8 });
      citadel.cyl(1.6, 2.2, 62, sx * 32, 60, -18, cc, { segments: 8 });
      citadel.cyl(0, 2.2, 10, sx * 32, 96, -18, hazed("#8c9890", 0.5), { segments: 8 });
    }
    const pyr = new GeoBuilder();
    pyr.cyl(0, 150, 140, 0, 70, 0, hazed("#d0a86c", 0.62), { segments: 4, rot: [0, Math.PI / 4, 0] });
    pyr.cyl(0, 130, 128, 240, 64, -120, hazed("#d0a86c", 0.68), { segments: 4, rot: [0, Math.PI / 4, 0] });
    pyr.cyl(0, 60, 58, 400, 29, -180, hazed("#d0a86c", 0.72), { segments: 4, rot: [0, Math.PI / 4, 0] });
    return { tower: tower.build(), citadel: citadel.build(), pyr: pyr.build() };
  }, []);
  const mat = useMemo(() => new MeshLambertMaterial({ fog: false }), []);
  const lmMat = useMemo(() => new MeshLambertMaterial({ vertexColors: true, fog: false }), []);
  const boxGeo = useMemo(() => new BoxGeometry(1, 1, 1), []);
  useEffect(
    () => () => {
      mat.dispose();
      lmMat.dispose();
      boxGeo.dispose();
      Object.values(landmarks).forEach((g) => g.dispose());
    },
    [mat, lmMat, boxGeo, landmarks],
  );
  return (
    <group>
      <instancedMesh ref={ref} args={[boxGeo, mat, data.mats.length]} />
      <mesh geometry={landmarks.tower} material={lmMat} position={[250, GROUND_Y, -640]} />
      <mesh geometry={landmarks.citadel} material={lmMat} position={[-420, GROUND_Y, -560]} />
      <mesh geometry={landmarks.pyr} material={lmMat} position={[-900, GROUND_Y, -1250]} />
    </group>
  );
}

// ---------------------------------------------------------------------------

export default function CityScape({ quality }: { quality: "high" | "low" }) {
  const shared = useMemo<SharedCity>(() => {
    const facade = createFacadeTexture(11);
    const brick = createBrickTexture(5);
    brick.repeat.set(3, 1);
    const tank = new CylinderGeometry(0.65, 0.65, 1.4, 8);
    const dish = new CylinderGeometry(0.55, 0.08, 0.22, 10);
    const tankC = new Float32Array(tank.getAttribute("position").count * 3).fill(0.15);
    tank.setAttribute("color", new Float32BufferAttribute(tankC, 3));
    const dishC = new Float32Array(dish.getAttribute("position").count * 3).fill(0.92);
    dish.setAttribute("color", new Float32BufferAttribute(dishC, 3));
    const brickGeo = new BoxGeometry(1, 1, 1);
    brickGeo.translate(0, 0.5, 0);
    return {
      buildingGeos: VARIANTS.map(([w, h, d]) => buildingGeometry(w, h, d)),
      facadeMat: new MeshStandardMaterial({ map: facade, vertexColors: true, roughness: 0.95 }),
      brickGeo,
      brickMat: new MeshStandardMaterial({ map: brick, roughness: 1 }),
      tankGeo: tank,
      dishGeo: dish,
      propMat: new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
      mosqueGeo: buildMosque(),
      boatGeo: buildFelucca(),
    };
  }, []);
  useEffect(
    () => () => {
      shared.buildingGeos.forEach((g) => g.dispose());
      shared.facadeMat.map?.dispose();
      shared.facadeMat.dispose();
      shared.brickMat.map?.dispose();
      shared.brickMat.dispose();
      shared.brickGeo.dispose();
      shared.tankGeo.dispose();
      shared.dishGeo.dispose();
      shared.propMat.dispose();
      shared.mosqueGeo.dispose();
      shared.boatGeo.dispose();
    },
    [shared],
  );
  const dense = quality === "high";
  return (
    <group>
      {/* Dusty ground far below the deck */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y - 0.05, -300]}>
        <planeGeometry args={[1400, 1400]} />
        <meshStandardMaterial color="#a38c6b" roughness={1} />
      </mesh>
      {/* The Nile */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[NILE_X + 300, GROUND_Y + 0.1, -300]}>
        <planeGeometry args={[600, 1400]} />
        <meshStandardMaterial color="#4f8a86" roughness={0.18} metalness={0.25} />
      </mesh>
      {/* Corniche embankment */}
      <mesh position={[NILE_X - 1, GROUND_Y + 0.8, -300]}>
        <boxGeometry args={[3, 1.6, 1400]} />
        <meshStandardMaterial color="#c9b892" roughness={1} />
      </mesh>
      <Scroll z0={0} period={CHUNK_PERIOD} maxZ={CHUNK_MAX_Z}>
        <Chunk seed={1} shared={shared} dense={dense} />
      </Scroll>
      <Scroll z0={CHUNK_LEN} period={CHUNK_PERIOD} maxZ={CHUNK_MAX_Z}>
        <Chunk seed={2} shared={shared} dense={dense} />
      </Scroll>
      <DistantSkyline />
    </group>
  );
}
