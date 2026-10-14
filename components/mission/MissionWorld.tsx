"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Shape,
  ShapeGeometry,
  Euler,
  Vector3,
  type Texture,
} from "three";
import { useGameState } from "@/hooks/useGameState";
import { useMissionState } from "@/hooks/useMissionState";
import { GeoBuilder, seeded } from "@/lib/geometryKit";
import { MISSION, ROAD_HALF, STREET, streetLane } from "@/lib/mission/missionConfig";
import { riverDistance } from "@/lib/mission/cairoMap";
import { BridgeRails, Landmarks, Nile, landmarkSpots } from "./CairoScenery";
import { mission, type MissionPhase } from "@/lib/mission/missionStore";
import { routeToWorld, type Route, type RoutePoint } from "@/lib/mission/route";
import {
  ROAD_TILE,
  createBrickTexture,
  createCurbTexture,
  createFacadeTexture,
  createPavingTexture,
  createRoadTexture,
  createSignTexture,
} from "@/lib/textures";
import { HAZE, Sky, Sun, buildSideLamp } from "../game/BridgeEnvironment";
import { FACADE_COLORS, buildingGeometry } from "../game/CityScape";
import { HIDDEN_MATRIX } from "../game/TrafficCar";

const SIDEWALK_OUT = ROAD_HALF + STREET.sidewalk;
const tmpA: RoutePoint = { x: 0, z: 0, h: 0 };
const tmpB: RoutePoint = { x: 0, z: 0, h: 0 };
const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const p3 = new Vector3();
const s3 = new Vector3(1, 1, 1);

// ---------------------------------------------------------------------------
// Geometry along the route.

/** Flat strip between lateral offsets d0..d1 at height y; v = s / vScale. */
/** Streets extend this far beyond both ends of the route (camera sees behind the start). */
const EXTEND_BACK = 90;
const EXTEND_FWD = 80;

function ribbon(route: Route, d0: number, d1: number, y: number, vScale: number, s0 = -EXTEND_BACK, s1 = route.length + EXTEND_FWD, step = 2): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let k = 0;
  for (let s = s0; ; s += step) {
    const sc = Math.min(s, s1);
    routeToWorld(route, sc, d0, tmpA);
    routeToWorld(route, sc, d1, tmpB);
    pos.push(tmpA.x, y, tmpA.z, tmpB.x, y, tmpB.z);
    uv.push(0, sc / vScale, 1, sc / vScale);
    if (k > 0) {
      const a = (k - 1) * 2;
      // winding so the face points up
      if (d1 > d0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    k++;
    if (sc >= s1) break;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Vertical strip (curb face) at offset d between heights y0..y1. */
function wall(route: Route, d: number, y0: number, y1: number, vScale: number): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let k = 0;
  const end = route.length + EXTEND_FWD;
  for (let s = -EXTEND_BACK; ; s += 2) {
    const sc = Math.min(s, end);
    routeToWorld(route, sc, d, tmpA);
    pos.push(tmpA.x, y0, tmpA.z, tmpA.x, y1, tmpA.z);
    uv.push(sc / vScale, 0, sc / vScale, 1);
    if (k > 0) {
      const a = (k - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    k++;
    if (sc >= end) break;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Minimum distance from (x, z) to the centerline (coarse). */
function distToRoute(route: Route, x: number, z: number) {
  let best = Infinity;
  for (let i = 0; i <= route.length; i += 3) {
    const dx = route.xs[i] - x;
    const dz = route.zs[i] - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

// ---------------------------------------------------------------------------
// Static street: road, sidewalks, curbs, ground.

function Street({ route, shadows }: { route: Route; shadows: boolean }) {
  const gl = useThree((s) => s.gl);
  const res = useMemo(() => {
    const roadTex = createRoadTexture(STREET.lanes, route.seed % 1000);
    roadTex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    const paving = createPavingTexture(route.seed % 997);
    paving.repeat.set(1.2, 1);
    const curbTex = createCurbTexture();
    return {
      roadTex,
      paving,
      curbTex,
      road: ribbon(route, -ROAD_HALF, ROAD_HALF, 0, ROAD_TILE),
      walkR: ribbon(route, ROAD_HALF, SIDEWALK_OUT, STREET.curbHeight, 4),
      walkL: ribbon(route, -ROAD_HALF, -SIDEWALK_OUT, STREET.curbHeight, 4),
      curbR: wall(route, ROAD_HALF, 0, STREET.curbHeight, 4),
      curbL: wall(route, -ROAD_HALF, STREET.curbHeight, 0, 4),
    };
  }, [route, gl]);
  useEffect(
    () => () => {
      [res.roadTex, res.paving, res.curbTex].forEach((t) => t.dispose());
      [res.road, res.walkR, res.walkL, res.curbR, res.curbL].forEach((g) => g.dispose());
    },
    [res],
  );
  // Ground plane centered on the route's bounding box.
  const ground = useMemo(() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i <= route.length; i += 10) {
      minX = Math.min(minX, route.xs[i]);
      maxX = Math.max(maxX, route.xs[i]);
      minZ = Math.min(minZ, route.zs[i]);
      maxZ = Math.max(maxZ, route.zs[i]);
    }
    return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: maxX - minX + 700, d: maxZ - minZ + 700 };
  }, [route]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ground.x, -0.6, ground.z]} receiveShadow={shadows}>
        <planeGeometry args={[ground.w, ground.d]} />
        <meshStandardMaterial color="#a8916e" roughness={1} />
      </mesh>
      <mesh geometry={res.road} receiveShadow={shadows}>
        <meshStandardMaterial map={res.roadTex} roughness={0.92} />
      </mesh>
      <mesh geometry={res.walkR} receiveShadow={shadows}>
        <meshStandardMaterial map={res.paving} roughness={0.95} />
      </mesh>
      <mesh geometry={res.walkL} receiveShadow={shadows}>
        <meshStandardMaterial map={res.paving} roughness={0.95} />
      </mesh>
      <mesh geometry={res.curbR}>
        <meshStandardMaterial map={res.curbTex} roughness={0.8} side={DoubleSide} />
      </mesh>
      <mesh geometry={res.curbL}>
        <meshStandardMaterial map={res.curbTex} roughness={0.8} side={DoubleSide} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Buildings with ground-floor Arabic shop signs, and street lamps.

/** [depth (across), height, frontage (along road)] */
const BLOCKS: [number, number, number][] = [
  [11, 15, 13],
  [10, 22, 11],
  [12, 12, 16],
];

const SHOPS = [
  { title: "كشري ونص", bg: "#f6c21c", fg: "#b5141f" },
  { title: "صيدلية الشفاء", bg: "#1b8a4c", fg: "#ffffff" },
  { title: "بقالة الأمانة", bg: "#1d4f9c", fg: "#ffffff" },
  { title: "عصير قصب", bg: "#18a39a", fg: "#ffffff" },
  { title: "حلاق الأناقة", bg: "#2a2a2a", fg: "#f6c21c" },
  { title: "مكوجي رجل", bg: "#e8e2d0", fg: "#1a1a1a" },
  { title: "فول وطعمية", bg: "#b5141f", fg: "#ffffff" },
  { title: "موبايلات وإكسسوارات", bg: "#6b2c91", fg: "#ffffff" },
];

interface Placement {
  m: Matrix4;
  color: Color;
}

function Buildings({ route, avoid }: { route: Route; avoid: { s: number; radius: number; side: number }[] }) {
  const layout = useMemo(() => {
    const rnd = seeded(route.seed ^ 0x5bd1e995);
    const blocks: Placement[][] = BLOCKS.map(() => []);
    const bricks: Matrix4[] = [];
    const signs: Matrix4[][] = SHOPS.map(() => []);
    for (const side of [1, -1]) {
      let s = -EXTEND_BACK + rnd() * 6;
      while (s < route.length + EXTEND_FWD - 10) {
        const v = Math.floor(rnd() * BLOCKS.length);
        const [depth, height, front] = BLOCKS[v];
        const sy = 0.85 + rnd() * 0.5;
        const sz = 0.85 + rnd() * 0.25;
        const frontLen = front * sz;
        const sc = s + frontLen / 2;
        const wet = route.wet[Math.max(0, Math.min(route.length, Math.round(sc)))] === 1;
        const blocked = wet || avoid.some((a) => side === a.side && Math.abs(sc - a.s) < a.radius);
        const dOff = side * (SIDEWALK_OUT + 0.3 + depth / 2);
        routeToWorld(route, sc, dOff, tmpA);
        const clearance = distToRoute(route, tmpA.x, tmpA.z);
        if (!blocked && clearance > SIDEWALK_OUT + depth / 2 - 0.6 && riverDistance(tmpA.x, tmpA.z) > depth) {
          e.set(0, tmpA.h, 0);
          q.setFromEuler(e);
          const m = new Matrix4().compose(new Vector3(tmpA.x, 0, tmpA.z), q, new Vector3(1, sy, sz));
          blocks[v].push({ m, color: new Color(FACADE_COLORS[Math.floor(rnd() * FACADE_COLORS.length)]) });
          if (rnd() < 0.3) {
            const bm = new Matrix4().compose(new Vector3(tmpA.x, height * sy, tmpA.z), q, new Vector3(depth * 0.7, 3, frontLen * 0.6));
            bricks.push(bm);
          }
          if (rnd() < 0.75) {
            const k = Math.floor(rnd() * SHOPS.length);
            // Sign on the road-facing wall, at shop-front height.
            routeToWorld(route, sc, side * (SIDEWALK_OUT + 0.24), tmpB);
            e.set(0, tmpB.h - side * (Math.PI / 2), 0);
            q.setFromEuler(e);
            const w = Math.min(frontLen * 0.8, 9);
            signs[k].push(new Matrix4().compose(new Vector3(tmpB.x, 3.7, tmpB.z), q, new Vector3(w, w / 4, 1)));
          }
        }
        s += frontLen + 0.6 + rnd() * 2.5;
      }
    }
    return { blocks, bricks, signs };
  }, [route, avoid]);

  const res = useMemo(() => {
    const facade = createFacadeTexture(route.seed % 31);
    const brick = createBrickTexture(5);
    brick.repeat.set(3, 1);
    const signTex = SHOPS.map((sh) => createSignTexture({ bg: sh.bg, title: sh.title, titleColor: sh.fg, w: 512, h: 128, border: sh.fg, display: true }));
    return {
      geos: BLOCKS.map(([w, h, d]) => buildingGeometry(w, h, d)),
      facadeMat: new MeshStandardMaterial({ map: facade, vertexColors: true, roughness: 0.95 }),
      brickMat: new MeshStandardMaterial({ map: brick, roughness: 1 }),
      signMats: signTex.map((t) => new MeshStandardMaterial({ map: t, roughness: 0.6, emissive: "#ffffff", emissiveMap: t, emissiveIntensity: 0.15 })),
      signGeo: new PlaneGeometry(1, 1),
      textures: [facade, brick, ...signTex] as Texture[],
    };
  }, [route]);
  useEffect(
    () => () => {
      res.geos.forEach((g) => g.dispose());
      res.textures.forEach((t) => t.dispose());
      res.facadeMat.dispose();
      res.brickMat.dispose();
      res.signMats.forEach((m) => m.dispose());
      res.signGeo.dispose();
    },
    [res],
  );
  return (
    <group>
      {layout.blocks.map((items, v) => (
        <Instances key={v} geo={res.geos[v]} mat={res.facadeMat} matrices={items.map((i) => i.m)} colors={items.map((i) => i.color)} />
      ))}
      <BrickTops matrices={layout.bricks} mat={res.brickMat} />
      {layout.signs.map((items, k) => (
        <Instances key={k} geo={res.signGeo} mat={res.signMats[k]} matrices={items} />
      ))}
    </group>
  );
}

function BrickTops({ matrices, mat }: { matrices: Matrix4[]; mat: MeshStandardMaterial }) {
  // Unit box with its base at y = 0, scaled per instance.
  const geo = useMemo(() => new GeoBuilder().box(1, 1, 1, 0, 0.5, 0, "#ffffff").build(), []);
  useEffect(() => () => geo.dispose(), [geo]);
  return <Instances geo={geo} mat={mat} matrices={matrices} />;
}

function Instances({ geo, mat, matrices, colors }: { geo: BufferGeometry; mat: MeshStandardMaterial; matrices: Matrix4[]; colors?: Color[] }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    matrices.forEach((mat4, i) => m.setMatrixAt(i, mat4));
    colors?.forEach((c, i) => m.setColorAt(i, c));
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [matrices, colors]);
  if (matrices.length === 0) return null;
  return <instancedMesh ref={ref} args={[geo, mat, matrices.length]} />;
}

function StreetLamps({ route, shadows }: { route: Route; shadows: boolean }) {
  const res = useMemo(() => {
    const geo = buildSideLamp();
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
    const mats: Matrix4[] = [];
    for (let s = 20 - EXTEND_BACK; s < route.length + EXTEND_FWD; s += 34) {
      for (const side of [1, -1]) {
        const ss = s + (side < 0 ? 17 : 0);
        if (ss >= route.length + EXTEND_FWD) continue;
        routeToWorld(route, ss, side * (ROAD_HALF + 0.55), tmpA);
        // The lamp's arm reaches toward -x locally; turn it to overhang the road.
        e.set(0, tmpA.h + (side < 0 ? Math.PI : 0), 0);
        q.setFromEuler(e);
        mats.push(new Matrix4().compose(new Vector3(tmpA.x, STREET.curbHeight, tmpA.z), q, new Vector3(0.8, 0.8, 0.8)));
      }
    }
    return { geo, mat, mats };
  }, [route]);
  useEffect(
    () => () => {
      res.geo.dispose();
      res.mat.dispose();
    },
    [res],
  );
  return <InstancesShadow geo={res.geo} mat={res.mat} matrices={res.mats} shadows={shadows} />;
}

function InstancesShadow({ geo, mat, matrices, shadows }: { geo: BufferGeometry; mat: MeshStandardMaterial; matrices: Matrix4[]; shadows: boolean }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    matrices.forEach((mat4, i) => m.setMatrixAt(i, mat4));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [matrices]);
  return <instancedMesh ref={ref} args={[geo, mat, matrices.length]} castShadow={shadows} />;
}

// ---------------------------------------------------------------------------
// Mission markers: pickup & drop-off zones, route chevrons, destination beacon.

function zoneVisible(kind: "pickup" | "drop", phase: MissionPhase) {
  if (kind === "pickup") return phase === "missionStart" || phase === "approachingPassenger" || phase === "pickupAvailable";
  return phase === "navigating" || phase === "arriving" || phase === "passengerOnboard";
}

function Zones({ route }: { route: Route }) {
  const phase = useMissionState((s) => s.phase);
  const pickupRef = useRef<Mesh>(null);
  const dropRef = useRef<Mesh>(null);
  const res = useMemo(() => {
    const lane = streetLane(2);
    const half = STREET.laneWidth / 2 - 0.15;
    return {
      pickup: ribbon(route, lane - half, lane + half, 0.07, 1, route.passengerS - MISSION.pickupBefore, route.passengerS + MISSION.pickupAfter, 1),
      drop: ribbon(route, lane - half, lane + half, 0.07, 1, route.dropS - MISSION.dropHalf, route.dropS + MISSION.dropHalf, 1),
      pickupMat: new MeshBasicMaterial({ color: "#f6c21c", transparent: true, opacity: 0.35, depthWrite: false }),
      dropMat: new MeshBasicMaterial({ color: "#2ee6b8", transparent: true, opacity: 0.35, depthWrite: false }),
    };
  }, [route]);
  useEffect(
    () => () => {
      res.pickup.dispose();
      res.drop.dispose();
      res.pickupMat.dispose();
      res.dropMat.dispose();
    },
    [res],
  );
  useFrame(({ clock }) => {
    const pulse = 0.26 + Math.sin(clock.elapsedTime * 4) * 0.1;
    // Brighter while the tuk-tuk is inside the zone.
    res.pickupMat.opacity = pulse + (mission.inZone ? 0.2 : 0);
    res.dropMat.opacity = pulse + (mission.inZone ? 0.2 : 0);
  });
  return (
    <>
      <mesh ref={pickupRef} geometry={res.pickup} material={res.pickupMat} visible={zoneVisible("pickup", phase)} renderOrder={1} />
      <mesh ref={dropRef} geometry={res.drop} material={res.dropMat} visible={zoneVisible("drop", phase)} renderOrder={1} />
    </>
  );
}

const CHEVRONS = 12;
const CHEVRON_GAP = 9;

/** Arrow decals on the road ahead, following the actual route to the current goal. */
function RouteChevrons({ route }: { route: Route }) {
  const ref = useRef<InstancedMesh>(null);
  const phase = useMissionState((s) => s.phase);
  const res = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(-0.9, 0.2);
    shape.lineTo(0, 1.1);
    shape.lineTo(0.9, 0.2);
    shape.lineTo(0.9, -0.35);
    shape.lineTo(0, 0.55);
    shape.lineTo(-0.9, -0.35);
    shape.closePath();
    const g = new ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2); // lie flat, pointing toward -z (forward)
    const mat = new MeshBasicMaterial({ color: "#ffd84a", transparent: true, opacity: 0.6, depthWrite: false, blending: AdditiveBlending });
    return { g, mat };
  }, []);
  useEffect(
    () => () => {
      res.g.dispose();
      res.mat.dispose();
    },
    [res],
  );
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const toPassenger = phase === "missionStart" || phase === "approachingPassenger";
    const toDrop = phase === "passengerOnboard" || phase === "navigating";
    const goal = toPassenger ? route.passengerS - 4 : toDrop ? route.dropS : -1;
    const base = Math.ceil((mission.s + 10) / CHEVRON_GAP) * CHEVRON_GAP;
    for (let i = 0; i < CHEVRONS; i++) {
      const s = base + i * CHEVRON_GAP;
      if (goal < 0 || s > goal || s >= route.length) {
        m.setMatrixAt(i, HIDDEN_MATRIX);
        continue;
      }
      // Lead into the curb lane over the last 120 m before the goal.
      const k = Math.min(1, Math.max(0, 1 - (goal - s) / 120));
      const d = streetLane(1) + (streetLane(2) - streetLane(1)) * k;
      routeToWorld(route, s, d, tmpA);
      e.set(0, tmpA.h, 0);
      q.setFromEuler(e);
      p3.set(tmpA.x, 0.09, tmpA.z);
      s3.set(1, 1, 1);
      m4.compose(p3, q, s3);
      m.setMatrixAt(i, m4);
    }
    m.instanceMatrix.needsUpdate = true;
    res.mat.opacity = 0.45 + Math.sin(clock.elapsedTime * 5) * 0.15;
  });
  return <instancedMesh ref={ref} args={[res.g, res.mat, CHEVRONS]} frustumCulled={false} renderOrder={2} />;
}

/** Tall light beam + spinning pin over the destination, visible above rooftops. */
function DestinationBeacon({ route }: { route: Route }) {
  const pin = useRef<Mesh>(null);
  const phase = useMissionState((s) => s.phase);
  const pos = useMemo(() => {
    routeToWorld(route, route.dropS, ROAD_HALF + 1.6, tmpA);
    return { x: tmpA.x, z: tmpA.z };
  }, [route]);
  useFrame(({ clock }) => {
    if (pin.current) {
      pin.current.rotation.y = clock.elapsedTime * 2;
      pin.current.position.y = 9 + Math.sin(clock.elapsedTime * 2.5) * 0.5;
    }
  });
  const show = phase === "passengerOnboard" || phase === "navigating" || phase === "arriving";
  return (
    <group position={[pos.x, 0, pos.z]} visible={show}>
      <mesh position={[0, 30, 0]}>
        <cylinderGeometry args={[1.1, 1.6, 60, 16, 1, true]} />
        <meshBasicMaterial color="#2ee6b8" transparent opacity={0.22} depthWrite={false} blending={AdditiveBlending} fog={false} side={DoubleSide} />
      </mesh>
      <mesh ref={pin} position={[0, 9, 0]}>
        <coneGeometry args={[1.2, 2.6, 4]} />
        <meshBasicMaterial color="#2ee6b8" fog={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------

export default function MissionWorld({ route }: { route: Route }) {
  const quality = useGameState((s) => s.quality);
  const shadows = quality === "high";
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => {
    scene.background = new Color(HAZE);
  }, [scene]);
  // Keep the curb clear of buildings around the landmarks (and the drop-off).
  const avoid = useMemo(
    () => [{ s: route.dropS, radius: 24, side: 1 }, ...landmarkSpots(route).map((p) => ({ s: p.s, radius: 30, side: p.side }))],
    [route],
  );
  return (
    <>
      <fog attach="fog" args={[HAZE, 45, 230]} />
      <Sky />
      <Sun shadows={shadows} />
      <Street route={route} shadows={shadows} />
      <Buildings route={route} avoid={avoid} />
      <StreetLamps route={route} shadows={shadows} />
      <Zones route={route} />
      <RouteChevrons route={route} />
      <DestinationBeacon route={route} />
      <Landmarks route={route} />
      <Nile />
      <BridgeRails route={route} />
    </>
  );
}
