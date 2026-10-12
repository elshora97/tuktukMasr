"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { gameStore, runtime } from "@/lib/gameStore";
import { getSoftDotTexture } from "@/lib/textures";
import { HIDDEN_MATRIX } from "./TrafficCar";

const m4 = new Matrix4();
const q = new Quaternion();
const eul = new Euler();
const pos = new Vector3();
const scl = new Vector3();

// ---------------------------------------------------------------------------
// Floating dust in the warm air — also sells the sense of speed.

function Dust({ count }: { count: number }) {
  const ref = useRef<Points>(null);
  const geo = useMemo(() => {
    const g = new BufferGeometry();
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 50;
      arr[i * 3 + 1] = 0.3 + Math.random() * 10;
      arr[i * 3 + 2] = 15 - Math.random() * 140;
    }
    g.setAttribute("position", new BufferAttribute(arr, 3));
    return g;
  }, [count]);
  const mat = useMemo(
    () =>
      new PointsMaterial({
        size: 0.22,
        map: getSoftDotTexture(),
        color: "#f3dcb2",
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    [],
  );
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  useFrame((_, rawDt) => {
    if (gameStore.getState().status === "paused") return;
    const dt = Math.min(rawDt, 0.05);
    const attr = geo.getAttribute("position") as BufferAttribute;
    const arr = attr.array as Float32Array;
    const S = runtime.speed;
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      arr[k + 2] += (S + 2) * dt;
      arr[k] += Math.sin(i + arr[k + 2] * 0.05) * dt * 0.4;
      if (arr[k + 2] > 15) {
        arr[k + 2] -= 140;
        arr[k] = (Math.random() - 0.5) * 50;
      }
    }
    attr.needsUpdate = true;
  });
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} />;
}

// ---------------------------------------------------------------------------
// Speed streaks at high speed.

const LINES = 34;

function SpeedLines() {
  const ref = useRef<InstancedMesh>(null);
  const data = useMemo(
    () =>
      Array.from({ length: LINES }, () => {
        const side = Math.random() < 0.5 ? -1 : 1;
        return { x: side * (3 + Math.random() * 9), y: 0.4 + Math.random() * 5.5, z: -Math.random() * 90 };
      }),
    [],
  );
  const geo = useMemo(() => new BoxGeometry(0.035, 0.035, 1), []);
  const mat = useMemo(
    () => new MeshBasicMaterial({ color: "#fff6e0", transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending }),
    [],
  );
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  useFrame((_, rawDt) => {
    const m = ref.current;
    if (!m) return;
    const st = gameStore.getState().status;
    const dt = st === "paused" ? 0 : Math.min(rawDt, 0.05);
    const S = runtime.speed;
    const k = Math.min(1, Math.max(0, (S - 27) / 18));
    const target = st === "playing" && runtime.crashT < 0 ? k * 0.32 + runtime.boost * 0.12 : 0;
    mat.opacity += (target - mat.opacity) * Math.min(1, dt * 4 + 0.02);
    m.visible = mat.opacity > 0.01;
    const len = 2 + k * 9;
    q.identity();
    for (let i = 0; i < LINES; i++) {
      const d = data[i];
      d.z += S * 1.7 * dt;
      if (d.z > 12) {
        d.z = -50 - Math.random() * 50;
        const side = Math.random() < 0.5 ? -1 : 1;
        d.x = side * (3 + Math.random() * 9) + runtime.playerX * 0.5;
      }
      pos.set(d.x, d.y, d.z);
      scl.set(1, 1, len);
      m4.compose(pos, q, scl);
      m.setMatrixAt(i, m4);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, LINES]} frustumCulled={false} />;
}

// ---------------------------------------------------------------------------
// Two-stroke exhaust puffs from the tuk-tuk.

const PUFFS = 16;

function Exhaust() {
  const ref = useRef<InstancedMesh>(null);
  const state = useRef({ timer: 0, next: 0, ages: new Float32Array(PUFFS).fill(9), p: Array.from({ length: PUFFS }, () => new Vector3()) });
  const geo = useMemo(() => new SphereGeometry(1, 7, 5), []);
  const mat = useMemo(() => new MeshBasicMaterial({ color: "#8b8580", transparent: true, opacity: 0.28, depthWrite: false }), []);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  useFrame((_, rawDt) => {
    const m = ref.current;
    if (!m) return;
    const st = gameStore.getState().status;
    if (st === "paused") return;
    const dt = Math.min(rawDt, 0.05);
    const s = state.current;
    const alive = runtime.crashT < 0;
    s.timer -= dt;
    if (alive && s.timer <= 0) {
      s.timer = st === "menu" ? 0.16 : 0.07;
      const i = s.next;
      s.next = (s.next + 1) % PUFFS;
      s.ages[i] = 0;
      s.p[i].set(runtime.playerX - 0.42, 0.32, 1.55);
    }
    const S = runtime.speed;
    for (let i = 0; i < PUFFS; i++) {
      const age = (s.ages[i] += dt);
      if (age > 0.9) {
        m.setMatrixAt(i, HIDDEN_MATRIX);
        continue;
      }
      const p = s.p[i];
      p.z += (S * 0.55 + 1.5) * dt;
      p.y += 0.7 * dt;
      p.x += Math.sin(age * 9 + i) * 0.2 * dt;
      const sz = (0.08 + age * 0.55) * (1 - age / 0.9);
      scl.set(sz, sz, sz);
      m4.compose(p, q.identity(), scl);
      m.setMatrixAt(i, m4);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, PUFFS]} frustumCulled={false} />;
}

// ---------------------------------------------------------------------------
// Crash: flying debris + smoke cloud.

const DEBRIS = 42;
const SMOKE = 14;
const DEBRIS_COLORS = ["#c3172a", "#f6c21c", "#a9d4ee", "#161616", "#18a39a", "#cfd4da"];

function CrashFX() {
  const debris = useRef<InstancedMesh>(null);
  const smoke = useRef<InstancedMesh>(null);
  const sim = useRef({
    active: false,
    t: 0,
    p: Array.from({ length: DEBRIS }, () => new Vector3()),
    v: Array.from({ length: DEBRIS }, () => new Vector3()),
    r: Array.from({ length: DEBRIS }, () => new Vector3()),
    s: new Float32Array(DEBRIS),
    sp: Array.from({ length: SMOKE }, () => new Vector3()),
  });
  const geos = useMemo(() => ({ box: new BoxGeometry(1, 1, 1), ball: new SphereGeometry(1, 8, 6) }), []);
  const mats = useMemo(
    () => ({
      debris: new MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 }),
      smoke: new MeshBasicMaterial({ color: "#6d6660", transparent: true, opacity: 0.5, depthWrite: false }),
    }),
    [],
  );
  useEffect(
    () => () => {
      geos.box.dispose();
      geos.ball.dispose();
      mats.debris.dispose();
      mats.smoke.dispose();
    },
    [geos, mats],
  );
  useLayoutEffect(() => {
    const d = debris.current;
    if (!d) return;
    const c = new Color();
    for (let i = 0; i < DEBRIS; i++) {
      d.setColorAt(i, c.set(DEBRIS_COLORS[i % DEBRIS_COLORS.length]));
      d.setMatrixAt(i, HIDDEN_MATRIX);
    }
    if (d.instanceColor) d.instanceColor.needsUpdate = true;
    d.instanceMatrix.needsUpdate = true;
    const s = smoke.current;
    if (s) {
      for (let i = 0; i < SMOKE; i++) s.setMatrixAt(i, HIDDEN_MATRIX);
      s.instanceMatrix.needsUpdate = true;
    }
  }, []);

  useFrame((_, rawDt) => {
    const d = debris.current;
    const sm = smoke.current;
    if (!d || !sm) return;
    const s = sim.current;
    if (runtime.crashT < 0) {
      if (s.active) {
        s.active = false;
        d.visible = false;
        sm.visible = false;
      }
      return;
    }
    if (!s.active) {
      s.active = true;
      s.t = 0;
      d.visible = true;
      sm.visible = true;
      for (let i = 0; i < DEBRIS; i++) {
        s.p[i].set(runtime.crashX + (Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 0.8, -1.2 + Math.random());
        s.v[i].set((Math.random() - 0.5) * 9, 3 + Math.random() * 7, -4 - Math.random() * 6);
        s.r[i].set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        s.s[i] = 0.06 + Math.random() * 0.16;
      }
      for (let i = 0; i < SMOKE; i++) {
        s.sp[i].set(runtime.crashX + (Math.random() - 0.5) * 1.6, 0.6 + Math.random() * 0.6, -1.5 + (Math.random() - 0.5) * 1.5);
      }
    }
    const dt = Math.min(rawDt, 0.05);
    s.t += dt;
    for (let i = 0; i < DEBRIS; i++) {
      const p = s.p[i];
      const v = s.v[i];
      v.y -= 22 * dt;
      p.addScaledVector(v, dt);
      if (p.y < 0.05) {
        p.y = 0.05;
        v.y *= -0.35;
        v.x *= 0.6;
        v.z *= 0.6;
      }
      const r = s.r[i];
      eul.set(r.x * s.t, r.y * s.t, r.z * s.t);
      q.setFromEuler(eul);
      const sz = s.s[i];
      scl.set(sz * 1.4, sz * 0.5, sz);
      m4.compose(p, q, scl);
      d.setMatrixAt(i, m4);
    }
    d.instanceMatrix.needsUpdate = true;
    const life = Math.min(1, s.t / 2.6);
    for (let i = 0; i < SMOKE; i++) {
      const p = s.sp[i];
      p.y += (0.8 + (i % 3) * 0.3) * dt;
      p.x += Math.sin(i * 1.7 + s.t) * 0.3 * dt;
      const sz = (0.5 + s.t * 1.1 + (i % 4) * 0.15) * (1 - life * 0.5);
      scl.set(sz, sz, sz);
      m4.compose(p, q.identity(), scl);
      sm.setMatrixAt(i, m4);
    }
    sm.instanceMatrix.needsUpdate = true;
    mats.smoke.opacity = 0.55 * (1 - life);
  });

  return (
    <>
      <instancedMesh ref={debris} args={[geos.box, mats.debris, DEBRIS]} frustumCulled={false} visible={false} castShadow />
      <instancedMesh ref={smoke} args={[geos.ball, mats.smoke, SMOKE]} frustumCulled={false} visible={false} />
    </>
  );
}

export default function Effects({ quality }: { quality: "high" | "low" }) {
  return (
    <>
      <Dust count={quality === "high" ? 260 : 110} />
      <SpeedLines />
      <Exhaust />
      <CrashFX />
    </>
  );
}
