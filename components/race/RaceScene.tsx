"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CanvasTexture, Color, CylinderGeometry, Euler, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, RepeatWrapping, SRGBColorSpace, Vector3 } from "three";
import { LAYOUT, PLAYER, VEHICLES, VEHICLE_TYPES, type VehicleType } from "@/lib/gameConfig";
import { gameStore, makePose, runtime, type TukTukPose } from "@/lib/gameStore";
import { audio } from "@/lib/audio";
import { seeded } from "@/lib/prng";
import { useRaceState } from "@/hooks/useRaceState";
import { raceActions, raceNet, raceStore, serverNow } from "@/lib/race/raceClient";
import type { TickPlayer } from "@/lib/race/protocol";
import { RACE, fireNitro, generateRaceCoins, generateRaceTraffic, lowerBound, makeRacer, startX, stepRacer, type RaceCar, type RaceCoin } from "@/lib/race/shared";
import { setAnchorTarget, removeAnchor } from "@/lib/screenAnchors";
import { fontStack } from "@/lib/textures";
import TrafficCar, { HIDDEN_MATRIX, LIGHT_NORMAL, type TrafficTypeMeshes } from "../game/TrafficCar";
import TukTuk from "../game/TukTuk";

/** Interpolation delay for other racers (smooths 20 Hz server ticks). */
const INTERP_DELAY = 0.12;
const SEND_INTERVAL = 0.05;

export interface RemoteRacer {
  pose: TukTukPose;
  d: number;
  stunPrev: boolean;
}

/** Mutable per-frame race state on this client. */
export const raceLocal = {
  raceId: -1,
  sim: makeRacer(),
  history: [] as { t: number; d: number }[],
  sendT: 0,
  lastHitT: -10,
  lastBeep: 99,
  traffic: [] as RaceCar[],
  coins: [] as RaceCoin[],
  /** Coin indices this client collected (hidden from the road). */
  taken: new Set<number>(),
  t: 0,
  /** Race time the local prediction has reached. */
  simT: 0,
  /** Set by the nitro button / key; consumed by the controller next frame. */
  nitroPressed: false,
  remotes: new Map<string, RemoteRacer>(),
  lastTickAt: 0,
};

function remoteFor(id: string): RemoteRacer {
  let r = raceLocal.remotes.get(id);
  if (!r) {
    r = { pose: makePose(), d: 0, stunPrev: false };
    raceLocal.remotes.set(id, r);
  }
  return r;
}

/** Race time t of this client's local d (history lookup). */
function historyD(t: number): number | null {
  const h = raceLocal.history;
  if (h.length === 0 || t < h[0].t) return null;
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].t <= t) {
      const a = h[i];
      const b = h[i + 1];
      if (!b) return a.d;
      return a.d + ((b.d - a.d) * (t - a.t)) / Math.max(1e-6, b.t - a.t);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------

export function RaceController() {
  useFrame((_, rawDt) => {
    const g = gameStore.getState();
    if (g.mode !== "race" || g.status === "menu") return;
    const { room, myId } = raceStore.getState();
    if (!room || room.startAt === null || !myId) return;
    const dt = Math.min(rawDt, 0.05);
    const L = raceLocal;
    const me = room.players.find((p) => p.id === myId);

    if (L.raceId !== room.raceId) {
      // New race: deterministic course from the room seed.
      L.raceId = room.raceId;
      L.sim = makeRacer();
      L.sim.x = startX(me?.slot ?? 0);
      L.history = [];
      L.simT = 0;
      L.nitroPressed = false;
      L.sendT = 0;
      L.lastHitT = -10;
      L.lastBeep = 99;
      L.traffic = generateRaceTraffic(room.seed, room.distance);
      L.coins = generateRaceCoins(room.seed, room.distance);
      L.taken = new Set();
      runtime.boost = 0;
      // Keep each remote's pose object (rendered tuk-tuks hold a reference); reset in place.
      for (const r of L.remotes.values()) {
        Object.assign(r.pose, makePose());
        r.d = 0;
        r.stunPrev = false;
      }
      runtime.playerX = runtime.targetX = L.sim.x;
      runtime.distance = 0;
      runtime.pose.spinT = -1;
    }
    const sim = L.sim;
    const t = (serverNow() - room.startAt) / 1000;
    L.t = t;

    // Countdown beeps: 3, 2, 1 … GO.
    if (t < 0) {
      const sec = Math.ceil(-t);
      if (sec !== L.lastBeep && sec <= 3) {
        L.lastBeep = sec;
        audio.beep(false);
      }
    } else if (L.lastBeep !== 0) {
      L.lastBeep = 0;
      audio.beep(true);
    }

    // Steering works on the grid too (pick a lane before the start).
    const held = Math.max(-1, Math.min(1, runtime.keySteer + runtime.padSteer));
    if (held !== 0) runtime.targetX += held * PLAYER.keyboardSteerSpeed * dt;
    runtime.targetX = Math.max(-PLAYER.xLimit, Math.min(PLAYER.xLimit, runtime.targetX));
    if (sim.stun <= 0) {
      const v = Math.max(-PLAYER.maxLateralSpeed, Math.min(PLAYER.maxLateralSpeed, (runtime.targetX - runtime.playerX) * PLAYER.followSharpness));
      runtime.playerX += v * dt;
    }

    if (t >= 0 && room.phase !== "lobby") {
      // Local prediction with the same step the server runs.
      if (L.nitroPressed) {
        L.nitroPressed = false;
        if (fireNitro(sim)) {
          raceActions.sendEvent("nitro", L.simT);
          audio.nitro();
          runtime.shake = Math.max(runtime.shake, 0.18);
        }
      }
      // Fixed sub-steps up to the real race time (like the server), so slow
      // frames never make the prediction fall behind and skip coins on a snap.
      const coinsBefore = sim.coins;
      let hit = false;
      if (t - L.simT > 0.5) L.simT = t - 0.5;
      while (L.simT < t) {
        const h = Math.min(1 / 60, t - L.simT);
        L.simT += h;
        const gotBefore = sim.coins;
        if (stepRacer(sim, runtime.playerX, h, L.simT, L.traffic, room.distance, L.coins)) {
          hit = true;
          raceActions.sendEvent("hit", L.simT);
        }
        if (sim.coins > gotBefore) {
          for (const i of sim.got) {
            if (L.taken.has(i)) continue;
            L.taken.add(i);
            raceActions.sendEvent("coin", L.simT, i);
          }
        }
      }
      if (sim.coins > coinsBefore) {
        audio.coin(sim.coins);
      }
      if (hit) {
        L.lastHitT = t;
        runtime.pose.spinT = 0;
        runtime.shake = 0.5;
        audio.horn({ gain: 0.14, pitch: 0.8, beeps: 2 });
      }
      L.history.push({ t, d: sim.d });
      while (L.history.length > 0 && L.history[0].t < t - 2.5) L.history.shift();
    }
    // Steering samples carry our race time; the server replays them at that time.
    L.sendT -= dt;
    if (L.sendT <= 0 && room.phase !== "lobby") {
      L.sendT = SEND_INTERVAL;
      raceActions.sendInput(runtime.playerX, t);
    }

    // Reconcile with the newest authoritative tick for this race.
    const latest = raceNet.ticks[raceNet.ticks.length - 1];
    if (latest && latest.tick.raceId === room.raceId && latest.at !== L.lastTickAt) {
      L.lastTickAt = latest.at;
      const mine = latest.tick.players.find((p) => p.id === myId);
      if (mine) {
        const local = historyD(mine.pt);
        if (local !== null) {
          const err = mine.d - local;
          if (Math.abs(err) > 0.25) {
            // Snap big errors, ease small ones; shift history so later comparisons stay valid.
            const fix = Math.abs(err) > 6 ? err : err * 0.35;
            sim.d += fix;
            for (const h of L.history) h.d += fix;
          }
        }
        if (mine.stun > 0 && sim.stun <= 0 && sim.ghost <= 0) {
          // Server saw a crash we didn't predict.
          sim.stun = mine.stun;
          sim.speed = 0;
          runtime.pose.spinT = 0;
          L.lastHitT = t;
        } else if (sim.stun > 0 && mine.stun <= 0 && mine.ghost <= 0 && mine.pt > L.lastHitT + 0.3) {
          // We predicted a crash the server didn't confirm: drive on.
          sim.stun = 0;
        }
        // Keep the coin count / tank in line with the server (rare edge pickups).
        if (mine.coins > sim.coins && mine.pt > L.lastHitT) {
          sim.tank = Math.min(RACE.nitroMaxS, sim.tank + (mine.coins - sim.coins) * RACE.coinNitroS);
          sim.coins = mine.coins;
        }
        if (mine.finished && !sim.finished) {
          sim.finished = true;
          sim.finishTime = mine.finishTime;
        }
      }
    }

    // Other racers: interpolate between ticks, INTERP_DELAY in the past.
    const renderT = t - INTERP_DELAY;
    const ticks = raceNet.ticks.filter((k) => k.tick.raceId === room.raceId);
    for (const p of room.players) {
      if (p.id === myId) continue;
      const r = remoteFor(p.id);
      let a: TickPlayer | null = null;
      let b: TickPlayer | null = null;
      let ta = 0;
      let tb = 0;
      for (let i = ticks.length - 1; i >= 0; i--) {
        const raw = ticks[i].tick.players.find((x) => x.id === p.id);
        if (!raw) continue;
        // Their sim trails the tick by their own latency; carry d forward to tick time.
        const lag = raw.stun > 0 ? 0 : Math.max(0, ticks[i].tick.t - raw.pt);
        const tp = lag > 0 ? { ...raw, d: raw.d + raw.speed * lag } : raw;
        if (ticks[i].tick.t <= renderT) {
          a = tp;
          ta = ticks[i].tick.t;
          break;
        }
        b = tp;
        tb = ticks[i].tick.t;
      }
      let d: number;
      let x: number;
      let stun = 0;
      let ghost = 0;
      const nitro = (a ?? b)?.nitro ?? 0;
      if (a && b) {
        const k = (renderT - ta) / Math.max(1e-6, tb - ta);
        d = a.d + (b.d - a.d) * k;
        x = a.x + (b.x - a.x) * k;
        stun = a.stun;
        ghost = a.ghost;
      } else if (a || b) {
        const s = (a ?? b)!;
        const st = a ? ta : tb;
        d = s.d + (s.stun > 0 ? 0 : s.speed * Math.min(0.3, Math.max(0, renderT - st)));
        x = s.x;
        stun = s.stun;
        ghost = s.ghost;
      } else {
        d = 0;
        x = startX(p.slot);
      }
      r.d = d;
      r.pose.x = x;
      r.pose.z = -(d - sim.d);
      r.pose.speed = stun > 0 ? 0 : t < 0 ? 0 : (a ?? b)?.speed ?? 0;
      r.pose.ghost = ghost > 0 ? 1 : 0;
      r.pose.boost = nitro > 0 ? 1 : r.pose.boost * Math.exp(-dt * 4);
      if (stun > 0 && !r.stunPrev) r.pose.spinT = 0;
      r.stunPrev = stun > 0;
      if (r.pose.spinT >= 0) r.pose.spinT = r.pose.spinT > 1 ? -1 : r.pose.spinT + dt;
    }

    // Publish my pose / world scroll.
    const pose = runtime.pose;
    pose.x = runtime.playerX;
    pose.z = 0;
    pose.heading = 0;
    pose.speed = sim.speed;
    pose.crashT = -1;
    pose.passenger = -1;
    pose.ghost = sim.ghost > 0 ? 1 : 0;
    runtime.boost = sim.nitro > 0 ? 1 : runtime.boost * Math.exp(-dt * 4);
    pose.boost = runtime.boost;
    if (pose.spinT >= 0) pose.spinT = pose.spinT > 1 ? -1 : pose.spinT + dt;
    runtime.distance = sim.d;
    runtime.speed = sim.speed;
    runtime.shake *= Math.exp(-dt * 4);
    audio.update(Math.max(sim.speed, 8), t < 0 ? "menu" : "playing", dt);
  });
  return null;
}

// ---------------------------------------------------------------------------
// Deterministic traffic, positioned from race time.

const RACE_PER_TYPE = 12;
const tmpM = new Matrix4();
const tmpP = new Vector3();
const tmpQ = new Quaternion();
const tmpS = new Vector3(1, 1, 1);
const tmpC = new Color();

export function RaceTraffic({ shadows }: { shadows: boolean }) {
  const meshes = useRef<Partial<Record<VehicleType, TrafficTypeMeshes>>>({});
  const used = useRef<Record<string, number>>({});
  const onReady = useCallback((type: VehicleType, m: TrafficTypeMeshes | null) => {
    if (m) meshes.current[type] = m;
    else delete meshes.current[type];
  }, []);
  // Stable per-car body colors.
  const colorFor = useMemo(() => {
    const cache = new Map<number, string>();
    return (i: number, type: VehicleType) => {
      let c = cache.get(i);
      if (!c) {
        const r = seeded(i * 7919 + 13)();
        const cols = VEHICLES[type].colors;
        c = cols[Math.floor(r * cols.length)];
        cache.set(i, c);
      }
      return c;
    };
  }, []);

  useFrame(() => {
    const L = raceLocal;
    const cars = L.traffic;
    const counts = used.current;
    for (const t of VEHICLE_TYPES) counts[t] = 0;
    const shift = RACE.trafficSpeed * Math.max(0, L.t);
    const d = L.sim.d;
    // Visible window: from 200 m ahead to 25 m behind the camera.
    for (let i = lowerBound(cars, d - shift - 25); i < cars.length; i++) {
      const c = cars[i];
      const z = -(c.s0 + shift - d);
      if (z < -200) break;
      const m = meshes.current[c.type];
      if (!m) continue;
      const slot = counts[c.type];
      if (slot >= RACE_PER_TYPE) continue;
      counts[c.type] = slot + 1;
      tmpP.set(c.x, 0, z);
      tmpM.compose(tmpP, tmpQ, tmpS);
      m.paint.setMatrixAt(slot, tmpM);
      m.detail.setMatrixAt(slot, tmpM);
      m.lights.setMatrixAt(slot, tmpM);
      m.paint.setColorAt(slot, tmpC.set(colorFor(i, c.type)));
      m.lights.setColorAt(slot, LIGHT_NORMAL);
    }
    for (const t of VEHICLE_TYPES) {
      const m = meshes.current[t];
      if (!m) continue;
      for (let k = counts[t]; k < RACE_PER_TYPE; k++) {
        m.paint.setMatrixAt(k, HIDDEN_MATRIX);
        m.detail.setMatrixAt(k, HIDDEN_MATRIX);
        m.lights.setMatrixAt(k, HIDDEN_MATRIX);
      }
      m.paint.instanceMatrix.needsUpdate = true;
      m.detail.instanceMatrix.needsUpdate = true;
      m.lights.instanceMatrix.needsUpdate = true;
      if (m.paint.instanceColor) m.paint.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group>
      {VEHICLE_TYPES.map((t) => (
        <TrafficCar key={t} type={t} capacity={RACE_PER_TYPE} shadows={shadows} onReady={onReady} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Nitro coins (static on the road; hidden once this client collects them).

const MAX_COINS = 48;
const coinEuler = new Euler();

export function RaceCoins() {
  const ref = useRef<InstancedMesh>(null);
  const geo = useMemo(() => {
    const g = new CylinderGeometry(0.42, 0.42, 0.09, 20);
    g.rotateX(Math.PI / 2); // face the camera
    return g;
  }, []);
  const mat = useMemo(
    () => new MeshStandardMaterial({ color: "#f6c21c", emissive: "#b8860b", emissiveIntensity: 0.55, metalness: 0.6, roughness: 0.3 }),
    [],
  );
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  const spin = useRef(0);
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    const L = raceLocal;
    const d = L.sim.d;
    spin.current += Math.min(dt, 0.05) * 3.2;
    let n = 0;
    for (let i = L.sim.coinIdx; i < L.coins.length && n < MAX_COINS; i++) {
      const c = L.coins[i];
      if (c.s > d + 190) break;
      if (L.taken.has(i)) continue;
      tmpP.set(c.x, 0.78 + Math.sin(spin.current * 1.3 + i) * 0.08, -(c.s - d));
      tmpQ.setFromEuler(coinEuler.set(0, spin.current + i * 0.4, 0));
      tmpM.compose(tmpP, tmpQ, tmpS);
      m.setMatrixAt(n++, tmpM);
    }
    tmpQ.identity();
    for (let k = n; k < MAX_COINS; k++) m.setMatrixAt(k, HIDDEN_MATRIX);
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, MAX_COINS]} frustumCulled={false} />;
}

// ---------------------------------------------------------------------------
// Other racers' tuk-tuks + their name tags.

function RemoteTukTuk({ id, paint }: { id: string; paint: number }) {
  const r = remoteFor(id);
  useEffect(() => {
    setAnchorTarget(
      "tag-" + id,
      (out) => {
        out.set(r.pose.x, 2.75, r.pose.z);
        return true;
      },
      { persistent: true },
    );
    return () => removeAnchor("tag-" + id);
  }, [id, r]);
  return <TukTuk pose={r.pose} paint={paint} shadows={false} detailed={false} />;
}

export function RemoteRacers() {
  const room = useRaceState((s) => s.room);
  const myId = useRaceState((s) => s.myId);
  if (!room) return null;
  return (
    <>
      {room.players
        .filter((p) => p.id !== myId)
        .map((p) => (
          <RemoteTukTuk key={p.id} id={p.id} paint={p.paint} />
        ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Start & finish lines.

function checkerTexture(label: string) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 192;
  const ctx = c.getContext("2d")!;
  const sq = 32;
  for (let y = 0; y < c.height; y += sq)
    for (let x = 0; x < c.width; x += sq) {
      ctx.fillStyle = (x / sq + y / sq) % 2 ? "#111" : "#f4f1ea";
      ctx.fillRect(x, y, sq, sq);
    }
  ctx.fillStyle = "#c3172a";
  ctx.fillRect(160, 28, 704, 136);
  ctx.strokeStyle = "#f6c21c";
  ctx.lineWidth = 8;
  ctx.strokeRect(164, 32, 696, 128);
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `400 96px ${fontStack("display")}`;
  ctx.fillStyle = "#f6c21c";
  ctx.fillText(label, 512, 102);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function stripeTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 16;
  const ctx = c.getContext("2d")!;
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 ? "#111" : "#f4f1ea";
      ctx.fillRect(x * 8, y * 8, 8, 8);
    }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.repeat.set(12, 1);
  return t;
}

export function RaceLines() {
  const finish = useRef<Group>(null);
  const start = useRef<Group>(null);
  const room = useRaceState((s) => s.room);
  const distance = room?.distance ?? RACE.distance;
  const tex = useMemo(() => ({ banner: checkerTexture("خط النهاية"), stripe: stripeTexture() }), []);
  useEffect(
    () => () => {
      tex.banner.dispose();
      tex.stripe.dispose();
    },
    [tex],
  );
  useFrame(() => {
    const d = raceLocal.sim.d;
    if (finish.current) finish.current.position.z = -(distance - d);
    if (start.current) start.current.position.z = d;
  });
  const left = LAYOUT.medianCenterX;
  const right = LAYOUT.rightBarrierX + 0.5;
  const width = right - left;
  return (
    <>
      <group ref={finish}>
        {[left, right].map((x) => (
          <mesh key={x} position={[x, 3.6, 0]}>
            <boxGeometry args={[0.35, 7.2, 0.35]} />
            <meshStandardMaterial color="#d7dce2" metalness={0.5} roughness={0.4} />
          </mesh>
        ))}
        <mesh position={[(left + right) / 2, 6.6, 0]}>
          <planeGeometry args={[width, 1.9]} />
          <meshBasicMaterial map={tex.banner} toneMapped={false} />
        </mesh>
        <mesh position={[(left + right) / 2 - 0.4, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[width - 1.2, 1.6]} />
          <meshBasicMaterial map={tex.stripe} />
        </mesh>
      </group>
      <group ref={start}>
        <mesh position={[(left + right) / 2 - 0.4, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[width - 1.2, 1.2]} />
          <meshBasicMaterial map={tex.stripe} />
        </mesh>
      </group>
    </>
  );
}
