"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, Euler, Matrix4, Quaternion, Vector3 } from "three";
import { PLAYER, VEHICLES, VEHICLE_TYPES, type VehicleType } from "@/lib/gameConfig";
import { aabbOverlap, TRAFFIC_HIT_SCALE_X, TRAFFIC_HIT_SCALE_Z, type Box2 } from "@/lib/collision";
import { gameStore, runtime } from "@/lib/gameStore";
import { audio } from "@/lib/audio";
import { MISSION, STREET, streetLane } from "@/lib/mission/missionConfig";
import { mission, missionActions, missionActive, missionStore } from "@/lib/mission/missionStore";
import { routeToWorld, type RoutePoint } from "@/lib/mission/route";
import TrafficCar, { HIDDEN_MATRIX, LIGHT_BRAKE, LIGHT_NORMAL, type TrafficTypeMeshes } from "../game/TrafficCar";

const PER_TYPE = 4;

interface StreetCar {
  active: boolean;
  type: VehicleType;
  slot: number;
  lane: number;
  s: number;
  /** Lateral offset within the lane. */
  offset: number;
  speed: number;
  cruise: number;
  halfW: number;
  halfL: number;
  brakeT: number;
  color: Color;
}

const pt: RoutePoint = { x: 0, z: 0, h: 0 };
const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const p3 = new Vector3();
const s3 = new Vector3(1, 1, 1);
const playerBox: Box2 = { x: 0, z: 0, halfW: 0, halfL: 0 };
const carBox: Box2 = { x: 0, z: 0, halfW: 0, halfL: 0 };

export default function MissionTraffic({ shadows }: { shadows: boolean }) {
  const meshes = useRef<Partial<Record<VehicleType, TrafficTypeMeshes>>>({});
  const cars = useMemo<StreetCar[]>(
    () =>
      VEHICLE_TYPES.flatMap((type) =>
        Array.from({ length: PER_TYPE }, (_, slot) => ({
          active: false,
          type,
          slot,
          lane: 0,
          s: 0,
          offset: 0,
          speed: 0,
          cruise: 0,
          halfW: VEHICLES[type].halfWidth,
          halfL: VEHICLES[type].halfLength,
          brakeT: 0,
          color: new Color(),
        })),
      ),
    [],
  );
  const sim = useRef({ tripId: -1, timer: 0 });
  useEffect(() => {
    // Debug handle for browser-automation testing in development.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __toktokStreetCars: unknown }).__toktokStreetCars = cars;
  }, [cars]);

  const onReady = useCallback((type: VehicleType, m: TrafficTypeMeshes | null) => {
    if (m) meshes.current[type] = m;
    else delete meshes.current[type];
  }, []);

  const hide = useCallback((c: StreetCar) => {
    c.active = false;
    const m = meshes.current[c.type];
    if (m) {
      m.paint.setMatrixAt(c.slot, HIDDEN_MATRIX);
      m.detail.setMatrixAt(c.slot, HIDDEN_MATRIX);
      m.lights.setMatrixAt(c.slot, HIDDEN_MATRIX);
    }
  }, []);

  /** Place a car at route distance s if there's room. */
  const spawn = useCallback(
    (s: number): boolean => {
      const route = mission.route;
      if (!route || s > route.length - 25) return false;
      const free = cars.filter((c) => !c.active);
      if (free.length === 0) return false;
      const car = free[Math.floor(Math.random() * free.length)];
      const spec = VEHICLES[car.type];
      // Keep the curb lane clear near the passenger and the destination.
      const nearTarget = Math.abs(s - route.passengerS) < MISSION.clearCurbLaneRadius || Math.abs(s - route.dropS) < MISSION.clearCurbLaneRadius;
      const lanes = [0, 1, 2].filter((l) => !(l === 2 && nearTarget)).sort(() => Math.random() - 0.5);
      const active = cars.filter((c) => c.active);
      // Never fill every lane around the spawn point.
      const busy = new Set(active.filter((o) => Math.abs(o.s - s) < 16).map((o) => o.lane));
      for (const lane of lanes) {
        if (busy.has(lane)) continue;
        if (busy.size + 1 >= STREET.lanes) break;
        car.active = true;
        car.lane = lane;
        car.s = s;
        car.offset = (Math.random() - 0.5) * 0.5;
        car.cruise = MISSION.trafficSpeedMin + Math.random() * (MISSION.trafficSpeedMax - MISSION.trafficSpeedMin);
        car.speed = car.cruise;
        car.halfW = spec.halfWidth;
        car.halfL = spec.halfLength;
        car.brakeT = 0;
        car.color.set(spec.colors[Math.floor(Math.random() * spec.colors.length)]).multiplyScalar(0.88 + Math.random() * 0.14);
        const m = meshes.current[car.type];
        if (m) {
          m.paint.setColorAt(car.slot, car.color);
          if (m.paint.instanceColor) m.paint.instanceColor.needsUpdate = true;
        }
        return true;
      }
      return false;
    },
    [cars],
  );

  useFrame((_, rawDt) => {
    const g = gameStore.getState();
    const route = mission.route;
    if (g.mode !== "taxi" || !route) return;
    const ms = missionStore.getState();
    const sm = sim.current;
    if (sm.tripId !== ms.tripId) {
      // New trip: clear and pre-fill the street ahead (well past the start).
      sm.tripId = ms.tripId;
      cars.forEach(hide);
      for (let s = 70; s < 420; s += 32 + Math.random() * 30) spawn(s);
      sm.timer = 1;
    }
    if (g.status === "paused") return;
    const dt = Math.min(rawDt, 0.05);
    const crashed = runtime.crashT >= 0;

    sm.timer -= dt;
    const activeCount = cars.reduce((n, c) => n + (c.active ? 1 : 0), 0);
    if (sm.timer <= 0 && !crashed) {
      if (activeCount < MISSION.trafficMax) spawn(mission.s + 140 + Math.random() * 40);
      sm.timer = 0.9 + Math.random() * 1.2;
    }

    const alive = missionActive(ms.phase) && !crashed;
    playerBox.x = mission.d;
    playerBox.z = mission.s;
    playerBox.halfW = PLAYER.halfWidth - PLAYER.hitShrinkX;
    playerBox.halfL = PLAYER.halfLength - PLAYER.hitShrinkZ;

    for (const c of cars) {
      if (!c.active) continue;
      // Leader in the same lane: a slower car, or the player's tuk-tuk.
      let limit = c.cruise;
      for (const o of cars) {
        if (!o.active || o === c || o.lane !== c.lane || o.s <= c.s) continue;
        const gap = o.s - o.halfL - (c.s + c.halfL);
        if (gap < 9) limit = Math.min(limit, gap < 3 ? o.speed * 0.6 : o.speed);
      }
      const laneD = streetLane(c.lane) + c.offset;
      if (mission.s > c.s && Math.abs(mission.d - laneD) < c.halfW + PLAYER.halfWidth + 0.4) {
        const gap = mission.s - PLAYER.halfLength - (c.s + c.halfL);
        if (gap < 10) limit = Math.min(limit, gap < 3.5 ? Math.max(0, mission.speed - 2) : mission.speed);
      }
      if (crashed && Math.abs(c.s - mission.s) < 30) limit = 0;
      if (limit < c.speed - 0.3) c.brakeT = 0.8;
      c.speed += (limit - c.speed) * Math.min(1, dt * (limit < c.speed ? 6 : 1.5));
      c.s += c.speed * dt;
      if (c.brakeT > 0) c.brakeT -= dt;

      if (alive && !runtime.godMode) {
        carBox.x = laneD;
        carBox.z = c.s;
        carBox.halfW = c.halfW * TRAFFIC_HIT_SCALE_X;
        carBox.halfL = c.halfL * TRAFFIC_HIT_SCALE_Z;
        if (aabbOverlap(playerBox, carBox)) {
          runtime.crashT = 0;
          runtime.shake = 1;
          runtime.pose.crashT = 0;
          missionActions.fail("crash");
          audio.crash();
        }
      }
      if (c.s < mission.s - 60 || c.s > route.length - 8) hide(c);
    }

    // Write instance matrices (follow the street's curve).
    for (const c of cars) {
      if (!c.active) continue;
      const m = meshes.current[c.type];
      if (!m) continue;
      routeToWorld(route, c.s, streetLane(c.lane) + c.offset, pt);
      e.set(0, pt.h, 0);
      q.setFromEuler(e);
      p3.set(pt.x, 0, pt.z);
      m4.compose(p3, q, s3);
      m.paint.setMatrixAt(c.slot, m4);
      m.detail.setMatrixAt(c.slot, m4);
      m.lights.setMatrixAt(c.slot, m4);
      m.lights.setColorAt(c.slot, c.brakeT > 0 ? LIGHT_BRAKE : LIGHT_NORMAL);
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
        <TrafficCar key={t} type={t} capacity={PER_TYPE} shadows={shadows} onReady={onReady} />
      ))}
    </group>
  );
}
