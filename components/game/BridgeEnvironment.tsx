"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BackSide,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Shape,
  ShaderMaterial,
  Texture,
  Vector3,
} from "three";
import { LAYOUT, ROAD } from "@/lib/gameConfig";
import { GeoBuilder } from "@/lib/geometryKit";
import { runtime } from "@/lib/gameStore";
import {
  ROAD_TILE,
  createConcreteTexture,
  createCurbTexture,
  createRoadTexture,
  createSignTexture,
  createSpeedSignTexture,
  roadTextureWidth,
  type SignSpec,
} from "@/lib/textures";
import { Scroll } from "./Scroll";
import CityScape from "./CityScape";

export const HAZE = "#e6cda6";
export const SUN_DIR = new Vector3(-0.42, 0.42, -0.8).normalize();

const ROAD_LEN = 400;
const ROAD_Z_CENTER = 40 - ROAD_LEN / 2;
const BARRIER_TILE = 8;
const CURB_TILE = 4;

// ---------------------------------------------------------------------------
// Sky dome: dusty Cairo afternoon gradient with a soft sun glow.

function Sky() {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          zenith: { value: new Color("#7fa6c9") },
          horizon: { value: new Color("#efd7ad") },
          ground: { value: new Color(HAZE) },
          sunDir: { value: SUN_DIR.clone() },
          sunColor: { value: new Color("#fff1cf") },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground;
          uniform vec3 sunDir; uniform vec3 sunColor;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.55, h));
            col = mix(ground, col, smoothstep(-0.08, 0.02, h));
            float s = max(dot(d, sunDir), 0.0);
            col += sunColor * (pow(s, 900.0) * 2.5 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.12);
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const ref = useRef<Object3D>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    ref.current?.position.copy(camera.position);
  });
  return (
    <mesh ref={ref} material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[900, 32, 16]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Sun with a shadow frustum that follows the tuk-tuk.

function Sun({ shadows }: { shadows: boolean }) {
  const light = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  useLayoutEffect(() => {
    if (light.current) light.current.target = target;
  }, [target]);
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    const px = runtime.playerX;
    target.position.set(px * 0.5, 0, -14);
    l.position.set(px * 0.5 + SUN_DIR.x * 70, SUN_DIR.y * 70, -14 + SUN_DIR.z * 70);
    target.updateMatrixWorld();
  });
  return (
    <>
      <hemisphereLight args={["#dce8f2", "#a27b52", 1.25]} />
      <directionalLight
        ref={light}
        color="#ffdcaa"
        intensity={2.7}
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={30}
        shadow-camera-bottom={-34}
        shadow-camera-near={1}
        shadow-camera-far={160}
      />
      <primitive object={target} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Road surfaces with scrolling worn-asphalt textures.

function Road({ shadows }: { shadows: boolean }) {
  const gl = useThree((s) => s.gl);
  const tex = useMemo(() => {
    const main = createRoadTexture(4, 7);
    const opp = createRoadTexture(LAYOUT.oppLanes, 19);
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
    for (const t of [main, opp]) {
      t.anisotropy = aniso;
      t.repeat.set(1, ROAD_LEN / ROAD_TILE);
    }
    return { main, opp };
  }, [gl]);
  useEffect(
    () => () => {
      tex.main.dispose();
      tex.opp.dispose();
    },
    [tex],
  );
  useFrame(() => {
    const o = (runtime.distance / ROAD_TILE) % 1;
    tex.main.offset.y = o;
    tex.opp.offset.y = o;
  });
  const mainW = roadTextureWidth(4);
  const oppW = roadTextureWidth(LAYOUT.oppLanes);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, ROAD_Z_CENTER]} receiveShadow={shadows}>
        <planeGeometry args={[mainW, ROAD_LEN]} />
        <meshStandardMaterial map={tex.main} roughness={0.92} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[LAYOUT.oppRoadCenterX, 0, ROAD_Z_CENTER]} receiveShadow={shadows}>
        <planeGeometry args={[oppW, ROAD_LEN]} />
        <meshStandardMaterial map={tex.opp} roughness={0.92} metalness={0} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Concrete New-Jersey barriers, painted curbs, deck edge, metal railings.

function njShape(mirror: boolean, symmetric = false) {
  const s = new Shape();
  const pts: [number, number][] = symmetric
    ? [
        [-0.6, 0],
        [-0.6, 0.08],
        [-0.46, 0.33],
        [-0.12, 0.95],
        [0.12, 0.95],
        [0.46, 0.33],
        [0.6, 0.08],
        [0.6, 0],
      ]
    : [
        [0, 0],
        [0, 0.08],
        [0.1, 0.33],
        [0.36, 1.05],
        [0.62, 1.05],
        [0.62, -1.4],
        [0, -1.4],
      ];
  const m = mirror ? -1 : 1;
  pts.forEach(([x, y], i) => (i === 0 ? s.moveTo(x * m, y) : s.lineTo(x * m, y)));
  s.closePath();
  return s;
}

function Barriers({ shadows }: { shadows: boolean }) {
  const { concrete, curb, geos } = useMemo(() => {
    const concrete = createConcreteTexture(3, true);
    concrete.repeat.set(1, 1 / BARRIER_TILE);
    const curb = createCurbTexture();
    curb.repeat.set(ROAD_LEN / CURB_TILE, 1);
    const opts = { depth: ROAD_LEN, bevelEnabled: false, steps: 1 };
    // Right barrier: shape extends +x from its inner face; left mirrored.
    const right = new ExtrudeGeometry(njShape(false), opts);
    const left = new ExtrudeGeometry(njShape(true), opts);
    const median = new ExtrudeGeometry(njShape(false, true), opts);
    return { concrete, curb, geos: { right, left, median } };
  }, []);
  useEffect(
    () => () => {
      concrete.dispose();
      curb.dispose();
      Object.values(geos).forEach((g) => g.dispose());
    },
    [concrete, curb, geos],
  );
  useFrame(() => {
    concrete.offset.y = (runtime.distance / BARRIER_TILE) % 1;
    curb.offset.x = -(runtime.distance / CURB_TILE) % 1;
  });

  const zStart = 40 - ROAD_LEN; // extrusion runs +z from here
  const deckLeft = LAYOUT.leftBarrierX - 0.62;
  const deckRight = LAYOUT.rightBarrierX + 0.62;
  return (
    <group>
      <mesh geometry={geos.right} position={[LAYOUT.rightBarrierX, 0, zStart]} receiveShadow={shadows} castShadow={shadows}>
        <meshStandardMaterial map={concrete} roughness={0.95} />
      </mesh>
      <mesh geometry={geos.left} position={[LAYOUT.leftBarrierX, 0, zStart]} receiveShadow={shadows}>
        <meshStandardMaterial map={concrete} roughness={0.95} />
      </mesh>
      <mesh geometry={geos.median} position={[LAYOUT.medianCenterX, 0, zStart]} receiveShadow={shadows} castShadow={shadows}>
        <meshStandardMaterial map={concrete} roughness={0.95} />
      </mesh>
      {/* Painted curb strips (black/yellow) along the barrier feet */}
      {[
        { x: LAYOUT.rightBarrierX - 0.005, ry: -Math.PI / 2 },
        { x: LAYOUT.medianCenterX + 0.605, ry: Math.PI / 2 },
        { x: LAYOUT.medianCenterX - 0.605, ry: -Math.PI / 2 },
        { x: LAYOUT.leftBarrierX + 0.005, ry: Math.PI / 2 },
      ].map((c, i) => (
        <mesh key={i} position={[c.x, 0.11, ROAD_Z_CENTER]} rotation={[0, c.ry, 0]}>
          <planeGeometry args={[ROAD_LEN, 0.22]} />
          <meshStandardMaterial map={curb} roughness={0.8} />
        </mesh>
      ))}
      {/* Deck slab, visible past the barriers above the city */}
      <mesh position={[(deckLeft + deckRight) / 2, -1.0, ROAD_Z_CENTER]}>
        <boxGeometry args={[deckRight - deckLeft, 1.6, ROAD_LEN]} />
        <meshStandardMaterial color="#a69c8c" roughness={1} />
      </mesh>
      {/* Railing tubes (posts are instanced & scrolling) */}
      {[LAYOUT.rightBarrierX + 0.5, LAYOUT.leftBarrierX - 0.5].map((x) =>
        [1.55, 2.0].map((y) => (
          <mesh key={`${x}-${y}`} position={[x, y, ROAD_Z_CENTER]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.045, 0.045, ROAD_LEN, 6]} />
            <meshStandardMaterial color="#2f5d4a" roughness={0.5} metalness={0.4} />
          </mesh>
        )),
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Instanced repeating props: railing posts and Cairo-style streetlights.

function useInstancedLayout(mesh: React.RefObject<InstancedMesh | null>, positions: [number, number, number][]) {
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const mat = new Matrix4();
    positions.forEach((p, i) => {
      mat.makeTranslation(p[0], p[1], p[2]);
      m.setMatrixAt(i, mat);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [mesh, positions]);
}

const POST_SPACING = 2.5;
const LIGHT_SPACING = 34;

function RailPosts() {
  const ref = useRef<InstancedMesh>(null);
  const positions = useMemo(() => {
    const p: [number, number, number][] = [];
    const n = Math.ceil(360 / POST_SPACING);
    for (let i = 0; i < n; i++) {
      const z = 35 - POST_SPACING * (i + 1);
      p.push([LAYOUT.rightBarrierX + 0.5, 1.55, z]);
      p.push([LAYOUT.leftBarrierX - 0.5, 1.55, z]);
    }
    return p;
  }, []);
  useInstancedLayout(ref, positions);
  return (
    <Scroll spacing={POST_SPACING}>
      <instancedMesh ref={ref} args={[undefined, undefined, positions.length]} frustumCulled={false}>
        <boxGeometry args={[0.07, 1.0, 0.07]} />
        <meshStandardMaterial color="#2f5d4a" roughness={0.5} metalness={0.4} />
      </instancedMesh>
    </Scroll>
  );
}

function buildMedianLamp() {
  const b = new GeoBuilder();
  const pole = "#7d8580";
  b.cyl(0.11, 0.17, 10.5, 0, 0.95 + 5.25, 0, pole, { segments: 8 });
  b.box(0.5, 0.5, 0.5, 0, 1.2, 0, "#6a706c");
  for (const sx of [-1, 1]) {
    b.box(2.6, 0.1, 0.1, sx * 1.3, 11.35, 0, pole, { rot: [0, 0, sx * 0.12] });
    b.box(0.9, 0.2, 0.38, sx * 2.65, 11.55, 0, "#5b605d");
    b.box(0.75, 0.04, 0.3, sx * 2.65, 11.43, 0, "#fff4cc");
  }
  // Tiny Egyptian flag pennant tied on some poles is a common sight
  b.box(0.02, 0.6, 0.02, 0, 9.1, 0.15, "#ddd");
  b.box(0.02, 0.12, 0.42, 0, 9.33, 0.36, "#ce1126");
  b.box(0.02, 0.12, 0.42, 0, 9.21, 0.36, "#ffffff");
  b.box(0.02, 0.12, 0.42, 0, 9.09, 0.36, "#111111");
  return b.build();
}

function buildSideLamp() {
  const b = new GeoBuilder();
  const pole = "#7d8580";
  b.cyl(0.1, 0.15, 9.5, 0, 4.75, 0, pole, { segments: 8 });
  b.box(2.4, 0.09, 0.09, -1.2, 9.6, 0, pole, { rot: [0, 0, -0.12] });
  b.box(0.85, 0.18, 0.36, -2.4, 9.8, 0, "#5b605d");
  b.box(0.7, 0.04, 0.28, -2.4, 9.69, 0, "#fff4cc");
  return b.build();
}

function StreetLights({ shadows }: { shadows: boolean }) {
  const median = useRef<InstancedMesh>(null);
  const side = useRef<InstancedMesh>(null);
  const geos = useMemo(() => ({ median: buildMedianLamp(), side: buildSideLamp() }), []);
  const mat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 }), []);
  useEffect(
    () => () => {
      geos.median.dispose();
      geos.side.dispose();
      mat.dispose();
    },
    [geos, mat],
  );
  const n = Math.ceil(380 / LIGHT_SPACING);
  const medianPos = useMemo(
    () => Array.from({ length: n }, (_, i) => [LAYOUT.medianCenterX, 0, 35 - LIGHT_SPACING * (i + 1)] as [number, number, number]),
    [n],
  );
  const sidePos = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => [LAYOUT.rightBarrierX + 0.45, 1.05, 35 - LIGHT_SPACING * (i + 1) - LIGHT_SPACING / 2] as [number, number, number]),
    [n],
  );
  useInstancedLayout(median, medianPos);
  useInstancedLayout(side, sidePos);
  return (
    <Scroll spacing={LIGHT_SPACING}>
      <instancedMesh ref={median} args={[geos.median, mat, n]} castShadow={shadows} frustumCulled={false} />
      <instancedMesh ref={side} args={[geos.side, mat, n]} castShadow={shadows} frustumCulled={false} />
    </Scroll>
  );
}

// ---------------------------------------------------------------------------
// Arabic signage: overhead gantries, roadside signs and rooftop billboards.

const GANTRY_PERIOD = 640;

const GANTRIES: { z0: number; signs: [SignSpec, SignSpec] }[] = [
  {
    z0: 0,
    signs: [
      { bg: "#0b6b3a", border: "#ffffff", title: "التحرير / وسط البلد", latin: "Tahrir / Downtown", arrow: "up" },
      { bg: "#0b6b3a", border: "#ffffff", title: "الزمالك", latin: "Zamalek", arrow: "right" },
    ],
  },
  {
    z0: 320,
    signs: [
      { bg: "#0b6b3a", border: "#ffffff", title: "مدينة نصر / المطار", latin: "Nasr City / Airport", arrow: "up" },
      { bg: "#0b6b3a", border: "#ffffff", title: "المهندسين", latin: "Mohandessin", arrow: "left" },
    ],
  },
];

/** Creates canvas textures once on mount and disposes them on unmount. */
function useTextures(factory: () => Texture[]) {
  const [textures] = useState(factory);
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);
  return textures;
}

function Gantry({ signs }: { signs: [SignSpec, SignSpec] }) {
  const textures = useTextures(() => signs.map((s) => createSignTexture(s)));
  const leftX = LAYOUT.medianCenterX;
  const rightX = LAYOUT.rightBarrierX + 0.5;
  const beamY = 7.4;
  return (
    <group>
      {[leftX, rightX].map((x) => (
        <mesh key={x} position={[x, beamY / 2, 0]}>
          <boxGeometry args={[0.36, beamY, 0.36]} />
          <meshStandardMaterial color="#8a918c" roughness={0.6} metalness={0.4} />
        </mesh>
      ))}
      <mesh position={[(leftX + rightX) / 2, beamY, 0]}>
        <boxGeometry args={[rightX - leftX + 0.4, 0.5, 0.5]} />
        <meshStandardMaterial color="#8a918c" roughness={0.6} metalness={0.4} />
      </mesh>
      {textures.map((t, i) => (
        <mesh key={i} position={[i === 0 ? -2.9 : 3.2, beamY - 0.2, 0.3]}>
          <planeGeometry args={[5.2, 2.6]} />
          <meshStandardMaterial map={t} roughness={0.5} emissive="#ffffff" emissiveMap={t} emissiveIntensity={0.18} />
        </mesh>
      ))}
    </group>
  );
}

const ROADSIDE_PERIOD = 640;

function RoadsideSigns() {
  const tex = useTextures(
    () => [
      createSpeedSignTexture("٦٠"),
      createSignTexture({ bg: "#1d4f9c", border: "#ffffff", title: "القيادة فن وذوق وأخلاق", sub: "الإدارة العامة للمرور", w: 512, h: 200 }),
      createSignTexture({ bg: "#ffffff", border: "#c8231e", title: "ممنوع استعمال آلة التنبيه", titleColor: "#c8231e", sub: "(يعني الكلاكس يا أسطى)", subColor: "#222", w: 512, h: 200 }),
      createSignTexture({ bg: "#0b6b3a", border: "#ffffff", title: "كوبري ٦ أكتوبر", latin: "6th of October Bridge", w: 512, h: 220 }),
      createSignTexture({ bg: "#f6c21c", border: "#1a1a1a", title: "خفّف السرعة", titleColor: "#1a1a1a", sub: "منزل الكوبري بعد ٥٠٠ متر", subColor: "#1a1a1a", w: 512, h: 220 }),
    ],
  );
  const x = LAYOUT.rightBarrierX + 0.5;
  const items = [
    { z0: 80, tex: 0, w: 1.3, h: 1.3, y: 3.2 },
    { z0: 230, tex: 1, w: 4.2, h: 1.64, y: 3.4 },
    { z0: 400, tex: 2, w: 4.2, h: 1.64, y: 3.4 },
    { z0: 520, tex: 3, w: 4.4, h: 1.9, y: 3.6 },
    { z0: 150, tex: 4, w: 4.0, h: 1.72, y: 3.4 },
  ];
  return (
    <>
      {items.map((it, i) => (
        <Scroll key={i} z0={it.z0} period={ROADSIDE_PERIOD} x={x}>
          <mesh position={[0, (1.05 + it.y - it.h / 2) / 2, 0]}>
            <boxGeometry args={[0.1, it.y - it.h / 2 - 1.05, 0.1]} />
            <meshStandardMaterial color="#8a918c" metalness={0.4} roughness={0.6} />
          </mesh>
          <mesh position={[1.0, it.y, 0.06]} rotation={[0, -0.25, 0]}>
            <planeGeometry args={[it.w, it.h]} />
            <meshStandardMaterial map={tex[it.tex]} transparent={it.tex === 0} alphaTest={0.5} roughness={0.5} emissive="#ffffff" emissiveMap={tex[it.tex]} emissiveIntensity={0.15} />
          </mesh>
          <mesh position={[1.0, it.y, 0.04]} rotation={[0, -0.25, 0]}>
            <planeGeometry args={[it.w, it.h]} />
            <meshStandardMaterial color="#6f7570" side={BackSide} />
          </mesh>
        </Scroll>
      ))}
    </>
  );
}

const BILLBOARD_PERIOD = 720;

function Billboards() {
  const tex = useTextures(
    () => [
      createSignTexture({ bg: "#f6c21c", title: "كشري الزعيم", titleColor: "#b5141f", sub: "أكبر طبق كشري في مصر.. والصلصة ببلاش", subColor: "#1a1a1a", display: true, stripe: "#b5141f" }),
      createSignTexture({ bg: "#b5141f", title: "شاي الصباحية", sub: "مزاج المصريين من زمان", display: true, stripe: "#f6c21c" }),
      createSignTexture({ bg: "#1d4f9c", title: "مدارس النور", sub: "التقديم مفتوح للعام الدراسي الجديد", display: true, stripe: "#ffffff" }),
      createSignTexture({ bg: "#18a39a", title: "عصير قصب أبو علي", sub: "اشرب واتهنّى.. ساقع ومتلّج", display: true, stripe: "#f6c21c" }),
    ],
  );
  const items = [
    { z0: 60, tex: 0, x: LAYOUT.rightBarrierX + 13, ry: -0.42 },
    { z0: 240, tex: 1, x: LAYOUT.leftBarrierX - 12, ry: 0.42 },
    { z0: 420, tex: 2, x: LAYOUT.rightBarrierX + 14, ry: -0.42 },
    { z0: 600, tex: 3, x: LAYOUT.leftBarrierX - 12, ry: 0.42 },
  ];
  const baseY = -ROAD.deckHeight;
  const top = 9;
  return (
    <>
      {items.map((it, i) => (
        <Scroll key={i} z0={it.z0} period={BILLBOARD_PERIOD} x={it.x}>
          <group rotation={[0, it.ry, 0]}>
            {[-3.5, 3.5].map((px) => (
              <mesh key={px} position={[px, (baseY + top) / 2, -0.3]}>
                <boxGeometry args={[0.35, top - baseY, 0.35]} />
                <meshStandardMaterial color="#4a4d50" roughness={0.7} metalness={0.5} />
              </mesh>
            ))}
            <mesh position={[0, top, 0]}>
              <planeGeometry args={[12, 6]} />
              <meshStandardMaterial map={tex[it.tex]} roughness={0.6} emissive="#ffffff" emissiveMap={tex[it.tex]} emissiveIntensity={0.12} />
            </mesh>
            <mesh position={[0, top, -0.15]}>
              <boxGeometry args={[12.3, 6.3, 0.25]} />
              <meshStandardMaterial color="#3a3c3f" roughness={0.8} />
            </mesh>
          </group>
        </Scroll>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------

export default function BridgeEnvironment({ shadows, quality }: { shadows: boolean; quality: "high" | "low" }) {
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => {
    scene.background = new Color(HAZE);
  }, [scene]);
  return (
    <>
      <fog attach="fog" args={[HAZE, 55, 300]} />
      <Sky />
      <Sun shadows={shadows} />
      <Road shadows={shadows} />
      <Barriers shadows={shadows} />
      <RailPosts />
      <StreetLights shadows={shadows} />
      {GANTRIES.map((g, i) => (
        <Scroll key={i} z0={g.z0} period={GANTRY_PERIOD}>
          <Gantry signs={g.signs} />
        </Scroll>
      ))}
      <RoadsideSigns />
      <Billboards />
      <CityScape quality={quality} />
    </>
  );
}
