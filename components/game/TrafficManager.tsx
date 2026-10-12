"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Color, Euler, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from "three";
import {
  LANES,
  PLAYER,
  SPEED,
  TRAFFIC,
  VEHICLES,
  VEHICLE_TYPES,
  difficultyFor,
  laneCenter,
  oppLaneCenter,
  LAYOUT,
  type VehicleType,
} from "@/lib/gameConfig";
import { aabbOverlap, isSpawnFair, playerHitBox, TRAFFIC_HIT_SCALE_X, TRAFFIC_HIT_SCALE_Z, type Box2, type LaneOccupant } from "@/lib/collision";
import { gameActions, gameStore, runtime } from "@/lib/gameStore";
import { audio } from "@/lib/audio";
import { getSoftDotTexture } from "@/lib/textures";
import TrafficCar, { HIDDEN_MATRIX, LIGHT_BRAKE, LIGHT_NORMAL, type TrafficTypeMeshes } from "./TrafficCar";

interface Car extends LaneOccupant {
  active: boolean;
  type: VehicleType;
  slot: number;
  x: number;
  halfW: number;
  offset: number;
  wobAmp: number;
  wobFreq: number;
  wobPhase: number;
  passed: boolean;
  overlapped: boolean;
  minGap: number;
  brakeT: number;
  spin: number;
  spinV: number;
  hit: boolean;
  color: Color;
}

const MENU_LANES = [0, 1, 3];
const ALL_LANES = Array.from({ length: LANES.count }, (_, i) => i);

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpP = new Vector3();
const tmpS = new Vector3(1, 1, 1);
const tmpV = new Vector3();
const playerBox: Box2 = { x: 0, z: 0, halfW: 0, halfL: 0 };
const carBox: Box2 = { x: 0, z: 0, halfW: 0, halfL: 0 };

function pickType(): VehicleType {
  let total = 0;
  for (const t of VEHICLE_TYPES) total += VEHICLES[t].weight;
  let r = Math.random() * total;
  for (const t of VEHICLE_TYPES) {
    r -= VEHICLES[t].weight;
    if (r <= 0) return t;
  }
  return "sedan";
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default function TrafficManager({ shadows }: { shadows: boolean }) {
  const camera = useThree((s) => s.camera);
  const meshes = useRef<Partial<Record<VehicleType, TrafficTypeMeshes>>>({});
  const shadowMesh = useRef<InstancedMesh>(null);

  const cars = useMemo<Car[]>(() => {
    const list: Car[] = [];
    for (const type of VEHICLE_TYPES) {
      for (let slot = 0; slot < TRAFFIC.poolPerType; slot++) {
        list.push({
          active: false,
          type,
          slot,
          lane: 0,
          x: 0,
          z: 0,
          speed: 0,
          halfL: VEHICLES[type].halfLength,
          halfW: VEHICLES[type].halfWidth,
          offset: 0,
          wobAmp: 0,
          wobFreq: 1,
          wobPhase: 0,
          passed: false,
          overlapped: false,
          minGap: Infinity,
          brakeT: 0,
          spin: 0,
          spinV: 0,
          hit: false,
          color: new Color(),
        });
      }
    }
    return list;
  }, []);

  const sim = useRef({ spawnTimer: 0.6, runId: -1, status: "", time: 0 });
  const active = useRef<Car[]>([]);

  const onReady = useCallback((type: VehicleType, m: TrafficTypeMeshes | null) => {
    if (m) meshes.current[type] = m;
    else delete meshes.current[type];
  }, []);

  const hideCar = useCallback((c: Car) => {
    c.active = false;
    const m = meshes.current[c.type];
    if (m) {
      m.paint.setMatrixAt(c.slot, HIDDEN_MATRIX);
      m.detail.setMatrixAt(c.slot, HIDDEN_MATRIX);
      m.lights.setMatrixAt(c.slot, HIDDEN_MATRIX);
    }
  }, []);

  /** Try to place one car. Returns true on success. */
  const trySpawn = useCallback(
    (z: number, lanes: number[], menu: boolean): boolean => {
      const type = pickType();
      let car = cars.find((c) => !c.active && c.type === type);
      if (!car) car = cars.find((c) => !c.active);
      if (!car) return false;
      const cspec = VEHICLES[car.type];
      const S = menu ? SPEED.menuCruise : runtime.speed;
      let speed: number;
      if (menu) {
        speed = SPEED.menuCruise * (0.25 + Math.random() * 0.5);
      } else {
        const frac = TRAFFIC.speedFracMin + Math.random() * (TRAFFIC.speedFracMax - TRAFFIC.speedFracMin);
        speed = SPEED.start * frac * cspec.speedBias;
        speed = Math.min(speed, S - 7);
      }
      const candidates = shuffle(lanes.slice());
      for (const lane of candidates) {
        // Same-lane spacing at the spawn point.
        let clear = true;
        for (const o of active.current) {
          if (o.lane === lane && Math.abs(o.z - z) < o.halfL + cspec.halfLength + TRAFFIC.minLaneGap) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;
        const cand: LaneOccupant = { lane, z, halfL: cspec.halfLength, speed };
        if (!menu && !isSpawnFair(cand, active.current, S)) continue;
        car.active = true;
        car.lane = lane;
        car.z = z;
        car.speed = speed;
        car.halfL = cspec.halfLength;
        car.halfW = cspec.halfWidth;
        const wiggle = LANES.width / 2 - cspec.halfWidth - 0.25;
        car.offset = (Math.random() * 2 - 1) * Math.max(0, wiggle) * 0.6;
        car.wobAmp = (car.type === "microbus" ? 0.22 : 0.08) + Math.random() * 0.08;
        car.wobFreq = 0.4 + Math.random() * 0.7;
        car.wobPhase = Math.random() * Math.PI * 2;
        car.x = laneCenter(lane) + car.offset;
        car.passed = false;
        car.overlapped = false;
        car.minGap = Infinity;
        car.brakeT = 0;
        car.spin = 0;
        car.spinV = 0;
        car.hit = false;
        car.color.set(cspec.colors[Math.floor(Math.random() * cspec.colors.length)]);
        // Slight per-car brightness variation so identical models feel different.
        car.color.multiplyScalar(0.88 + Math.random() * 0.14);
        const m = meshes.current[car.type];
        if (m) {
          m.paint.setColorAt(car.slot, car.color);
          if (m.paint.instanceColor) m.paint.instanceColor.needsUpdate = true;
        }
        active.current.push(car);
        return true;
      }
      return false;
    },
    [cars],
  );

  const reset = useCallback(
    (status: string) => {
      for (const c of cars) if (c.active) hideCar(c);
      active.current = [];
      const menu = status === "menu";
      if (menu) {
        for (let z = -150; z < -6; z += 9 + Math.random() * 10) trySpawn(z, MENU_LANES, true);
      } else {
        // Start with some traffic already ahead so the action begins quickly.
        for (let z = -60; z > TRAFFIC.spawnZ; z -= 14 + Math.random() * 10) trySpawn(z, ALL_LANES, false);
      }
      sim.current.spawnTimer = menu ? 1.5 : 0.8;
    },
    [cars, hideCar, trySpawn],
  );

  useEffect(() => {
    // Debug handle for browser-automation testing in development.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __toktokTraffic: unknown }).__toktokTraffic = active;
    return () => {
      active.current = [];
    };
  }, []);

  const shadowGeo = useMemo(() => {
    const g = new PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const shadowMat = useMemo(
    () => new MeshBasicMaterial({ map: getSoftDotTexture(), color: "#000000", transparent: true, opacity: 0.5, depthWrite: false }),
    [],
  );
  useEffect(
    () => () => {
      shadowGeo.dispose();
      shadowMat.dispose();
    },
    [shadowGeo, shadowMat],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const st = gameStore.getState();
    const s = sim.current;
    if (st.runId !== s.runId || (st.status === "menu" && s.status !== "menu")) {
      s.runId = st.runId;
      s.status = st.status;
      reset(st.status);
    }
    s.status = st.status;
    if (st.status === "paused") return;
    const menu = st.status === "menu";
    const playing = st.status === "playing";
    const crashed = runtime.crashT >= 0;
    s.time += dt;
    const S = runtime.speed;

    // --- Spawning
    s.spawnTimer -= dt;
    if (s.spawnTimer <= 0 && !crashed) {
      if (menu) {
        trySpawn(TRAFFIC.spawnZ * 0.85, MENU_LANES, true);
        s.spawnTimer = 1.6 + Math.random() * 1.5;
      } else if (playing) {
        const d = difficultyFor(runtime.distance);
        const interval = TRAFFIC.spawnIntervalStart + (TRAFFIC.spawnIntervalEnd - TRAFFIC.spawnIntervalStart) * d;
        let ok = trySpawn(TRAFFIC.spawnZ, ALL_LANES, false);
        // Occasional side-by-side pairs as the game heats up.
        if (ok && Math.random() < d * 0.45) ok = trySpawn(TRAFFIC.spawnZ - 2 - Math.random() * 6, ALL_LANES, false) || ok;
        s.spawnTimer = ok ? interval * (0.7 + Math.random() * 0.6) : 0.15;
      }
    }

    // --- Same-lane following (cars brake behind slower ones)
    const list = active.current;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.hit) continue;
      let ahead: Car | null = null;
      let best = Infinity;
      for (let j = 0; j < list.length; j++) {
        const b = list[j];
        if (b === a || b.lane !== a.lane || b.z >= a.z) continue;
        const gap = a.z - b.z;
        if (gap < best) {
          best = gap;
          ahead = b;
        }
      }
      if (ahead) {
        const gap = a.z - a.halfL - (ahead.z + ahead.halfL);
        if (gap < TRAFFIC.minLaneGap && a.speed > ahead.speed) {
          a.speed += (ahead.speed - a.speed) * Math.min(1, dt * 4);
          a.brakeT = 1.2;
        }
      }
    }

    // After a crash, traffic around and behind the tuk-tuk stops.
    if (crashed) {
      for (const c of list) if (c.z > -3 && !c.hit) {
        if (c.speed > 0.1) c.brakeT = 3;
        c.speed = Math.max(0, c.speed - dt * 30);
      }
    }

    // --- Integrate, collide, detect overtakes
    let alive = playing && !crashed;
    if (alive) playerHitBox(runtime.playerX, playerBox);
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      c.z += (S - c.speed) * dt;
      c.x = laneCenter(c.lane) + c.offset + Math.sin(s.time * c.wobFreq + c.wobPhase) * c.wobAmp;
      if (c.brakeT > 0) c.brakeT -= dt;
      if (c.spinV !== 0) {
        c.spin += c.spinV * dt;
        c.spinV *= Math.max(0, 1 - dt * 3);
      }

      if (alive) {
        const zOverlap = Math.abs(c.z) < c.halfL + PLAYER.halfLength + 0.6;
        if (zOverlap) {
          c.overlapped = true;
          const gap = Math.abs(c.x - runtime.playerX) - c.halfW - PLAYER.halfWidth;
          if (gap < c.minGap) c.minGap = gap;
        }
        carBox.x = c.x;
        carBox.z = c.z;
        carBox.halfW = c.halfW * TRAFFIC_HIT_SCALE_X;
        carBox.halfL = c.halfL * TRAFFIC_HIT_SCALE_Z;
        if (!runtime.godMode && aabbOverlap(playerBox, carBox)) {
          c.hit = true;
          c.speed = 0;
          c.spinV = (c.x > runtime.playerX ? 1 : -1) * 1.6;
          c.brakeT = 5;
          alive = false;
          gameActions.crash();
          audio.crash();
          continue;
        }
        if (!c.passed && c.z - c.halfL > PLAYER.halfLength) {
          c.passed = true;
          const closeCall = c.overlapped && c.minGap < TRAFFIC.closeCallDistance;
          tmpV.set(runtime.playerX, 2.6, 0).project(camera);
          const sx = Math.min(85, Math.max(15, ((tmpV.x + 1) / 2) * 100));
          const sy = Math.min(70, Math.max(20, ((1 - tmpV.y) / 2) * 100));
          gameActions.overtake(closeCall, sx, sy);
          audio.overtake(closeCall);
          runtime.boost = 1;
          if (closeCall && Math.random() < 0.7) {
            setTimeout(() => audio.horn({ gain: 0.12, pitch: 0.85 + Math.random() * 0.3, pan: c.x > runtime.playerX ? 0.5 : -0.5, beeps: 2 }), 120);
          }
        }
      } else if (!c.passed && c.z - c.halfL > PLAYER.halfLength) {
        c.passed = true;
      }

      if (c.z > TRAFFIC.despawnZ || c.z < TRAFFIC.spawnZ - 80) {
        hideCar(c);
        list.splice(i, 1);
      }
    }

    // --- Write instance matrices
    const shadowsIM = shadowMesh.current;
    let si = 0;
    for (const c of list) {
      const m = meshes.current[c.type];
      if (!m) continue;
      // Yaw follows the lateral wobble velocity (cars "steer" a little).
      const wobV = Math.cos(s.time * c.wobFreq + c.wobPhase) * c.wobAmp * c.wobFreq;
      tmpE.set(0, -wobV * 0.05 + c.spin, 0);
      tmpQ.setFromEuler(tmpE);
      tmpP.set(c.x, 0, c.z);
      tmpS.set(1, 1, 1);
      tmpM.compose(tmpP, tmpQ, tmpS);
      m.paint.setMatrixAt(c.slot, tmpM);
      m.detail.setMatrixAt(c.slot, tmpM);
      m.lights.setMatrixAt(c.slot, tmpM);
      m.lights.setColorAt(c.slot, c.brakeT > 0 ? LIGHT_BRAKE : LIGHT_NORMAL);
      if (shadowsIM && si < shadowsIM.count) {
        tmpS.set(c.halfW * 2.6, 1, c.halfL * 2.4);
        tmpP.set(c.x, 0.03, c.z);
        tmpM.compose(tmpP, tmpQ, tmpS);
        shadowsIM.setMatrixAt(si++, tmpM);
      }
    }
    if (shadowsIM) {
      for (let k = si; k < shadowsIM.count; k++) shadowsIM.setMatrixAt(k, HIDDEN_MATRIX);
      shadowsIM.instanceMatrix.needsUpdate = true;
    }
    for (const t of VEHICLE_TYPES) {
      const m = meshes.current[t];
      if (!m) continue;
      m.paint.instanceMatrix.needsUpdate = true;
      m.detail.instanceMatrix.needsUpdate = true;
      m.lights.instanceMatrix.needsUpdate = true;
      if (m.lights.instanceColor) m.lights.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group>
      {VEHICLE_TYPES.map((t) => (
        <TrafficCar key={t} type={t} capacity={TRAFFIC.poolPerType} shadows={shadows} onReady={onReady} />
      ))}
      <instancedMesh ref={shadowMesh} args={[shadowGeo, shadowMat, cars.length]} frustumCulled={false} renderOrder={1} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Oncoming traffic on the other carriageway: purely visual, no collisions.

const ONCOMING_TYPES: VehicleType[] = ["taxi", "microbus", "sedan", "suv"];
const ONCOMING_PER_TYPE = 3;
const ONCOMING_SPAN = 260;

interface Oncoming {
  type: VehicleType;
  slot: number;
  lane: number;
  z: number;
  speed: number;
  color: Color;
}

export function OncomingTraffic() {
  const meshes = useRef<Partial<Record<VehicleType, TrafficTypeMeshes>>>({});
  const colorsDirty = useRef(true);
  const cars = useMemo<Oncoming[]>(() => {
    const list: Oncoming[] = [];
    let k = 0;
    for (const type of ONCOMING_TYPES) {
      for (let slot = 0; slot < ONCOMING_PER_TYPE; slot++) {
        list.push({
          type,
          slot,
          lane: k % LAYOUT.oppLanes,
          z: -ONCOMING_SPAN + (k / (ONCOMING_TYPES.length * ONCOMING_PER_TYPE)) * (ONCOMING_SPAN + 20) + Math.random() * 8,
          speed: 12 + Math.random() * 10,
          color: new Color(VEHICLES[type].colors[Math.floor(Math.random() * VEHICLES[type].colors.length)]),
        });
        k++;
      }
    }
    return list;
  }, []);

  const onReady = useCallback((type: VehicleType, m: TrafficTypeMeshes | null) => {
    if (m) meshes.current[type] = m;
    else delete meshes.current[type];
    colorsDirty.current = true;
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const st = gameStore.getState();
    if (st.status === "paused") return;
    const S = runtime.speed;
    for (const c of cars) {
      c.z += (S + c.speed) * dt;
      if (c.z > 25) {
        c.z -= ONCOMING_SPAN + 25;
        c.lane = Math.floor(Math.random() * LAYOUT.oppLanes);
        c.speed = 12 + Math.random() * 10;
      }
      const m = meshes.current[c.type];
      if (!m) continue;
      tmpE.set(0, Math.PI, 0);
      tmpQ.setFromEuler(tmpE);
      tmpP.set(oppLaneCenter(c.lane), 0, c.z);
      tmpS.set(1, 1, 1);
      tmpM.compose(tmpP, tmpQ, tmpS);
      m.paint.setMatrixAt(c.slot, tmpM);
      m.detail.setMatrixAt(c.slot, tmpM);
      m.lights.setMatrixAt(c.slot, tmpM);
      if (colorsDirty.current) {
        m.paint.setColorAt(c.slot, c.color);
        m.lights.setColorAt(c.slot, LIGHT_NORMAL);
      }
    }
    for (const t of ONCOMING_TYPES) {
      const m = meshes.current[t];
      if (!m) continue;
      m.paint.instanceMatrix.needsUpdate = true;
      m.detail.instanceMatrix.needsUpdate = true;
      m.lights.instanceMatrix.needsUpdate = true;
      if (colorsDirty.current) {
        if (m.paint.instanceColor) m.paint.instanceColor.needsUpdate = true;
        if (m.lights.instanceColor) m.lights.instanceColor.needsUpdate = true;
      }
    }
    colorsDirty.current = false;
  });

  return (
    <group>
      {ONCOMING_TYPES.map((t) => (
        <TrafficCar key={t} type={t} capacity={ONCOMING_PER_TYPE} shadows={false} onReady={onReady} />
      ))}
    </group>
  );
}
