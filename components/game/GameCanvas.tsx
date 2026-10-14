"use client";

import { useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { PCFSoftShadowMap, PerspectiveCamera, Vector3 } from "three";
import { PLAYER, SPEED, playerSpeedFor } from "@/lib/gameConfig";
import { gameActions, gameStore, runtime } from "@/lib/gameStore";
import { audio } from "@/lib/audio";
import { updateAnchors } from "@/lib/screenAnchors";
import { useGameState } from "@/hooks/useGameState";
import { useMissionState } from "@/hooks/useMissionState";
import { mission, missionStore } from "@/lib/mission/missionStore";
import { raceStore } from "@/lib/race/raceClient";
import MissionController from "../mission/MissionController";
import MissionWorld from "../mission/MissionWorld";
import MissionTraffic from "../mission/MissionTraffic";
import MissionPassenger from "../mission/MissionPassenger";
import { RaceCoins, RaceController, RaceLines, RaceTraffic, RemoteRacers, raceLocal } from "../race/RaceScene";
import TukTuk from "./TukTuk";
import TrafficManager, { OncomingTraffic } from "./TrafficManager";
import BridgeEnvironment from "./BridgeEnvironment";
import Effects from "./Effects";

/** Delay after impact before the game-over overlay appears (crash animation). */
const CRASH_REVEAL_S = 1.15;

/**
 * Endless mode + the menu attract scene: speed, distance, steering, crash
 * timeline, audio. Passenger missions and online races have their own
 * controllers (MissionController / RaceController).
 */
function GameLoop() {
  useFrame((_, rawDt) => {
    const st = gameStore.getState();
    if (st.mode === "taxi") return;
    if (st.mode === "race" && st.status !== "menu") return;
    const dt = Math.min(rawDt, 0.05);
    step(st.status, dt);
    // Publish the pose the tuk-tuk renders from.
    const pose = runtime.pose;
    pose.x = runtime.crashT >= 0 ? runtime.crashX : runtime.playerX;
    pose.z = 0;
    pose.heading = 0;
    pose.speed = runtime.speed;
    pose.crashT = runtime.crashT;
    pose.boost = runtime.boost;
    pose.spinT = -1;
    pose.ghost = 0;
    pose.passenger = -1;
  });
  return null;
}

function step(status: string, dt: number) {
  if (runtime.hornRequested) {
    runtime.hornRequested = false;
    if (status !== "paused") audio.horn();
  }

  if (status === "paused") {
    audio.update(runtime.speed, "silent", dt);
    return;
  }

  if (runtime.crashT >= 0) {
    runtime.crashT += dt;
    runtime.speed *= Math.exp(-dt * 6);
    runtime.shake *= Math.exp(-dt * 3.5);
    if (runtime.crashT > CRASH_REVEAL_S) gameActions.revealGameOver();
    audio.update(runtime.speed, "silent", dt);
    return;
  }

  if (status === "playing") {
    runtime.time += dt;
    runtime.distance += runtime.speed * dt;
    runtime.speed = playerSpeedFor(runtime.distance);
    const held = Math.max(-1, Math.min(1, runtime.keySteer + runtime.padSteer));
    if (held !== 0) runtime.targetX += held * PLAYER.keyboardSteerSpeed * dt;
    runtime.targetX = Math.max(-PLAYER.xLimit, Math.min(PLAYER.xLimit, runtime.targetX));
    // Smooth, speed-limited follow toward the steering target.
    let v = (runtime.targetX - runtime.playerX) * PLAYER.followSharpness;
    v = Math.max(-PLAYER.maxLateralSpeed, Math.min(PLAYER.maxLateralSpeed, v));
    runtime.playerX += v * dt;
    runtime.boost *= Math.exp(-dt * 3);
    audio.update(runtime.speed, "playing", dt);
  } else {
    // Menu: idle cruise for the attract scene.
    runtime.speed += (SPEED.menuCruise - runtime.speed) * Math.min(1, dt * 2);
    runtime.distance += runtime.speed * dt;
    audio.update(runtime.speed, status === "menu" ? "menu" : "silent", dt);
  }
}

const camTarget = new Vector3();
const lookTarget = new Vector3();

function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const look = useRef(new Vector3(0, 1, -12));
  const orbit = useRef(0.9);
  const camHeading = useRef(0);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const { status: st, mode } = gameStore.getState();
    const aspect = size.width / Math.max(1, size.height);
    // 0 = landscape, 1 = tall portrait phone
    const p = Math.min(1, Math.max(0, (1.25 - aspect) / 0.75));
    const pose = runtime.pose;
    let fov: number;
    if (mode === "taxi") {
      // Chase along the street; the camera's heading lags a little through corners.
      camHeading.current += (pose.heading - camHeading.current) * Math.min(1, dt * 3.5);
      const h = camHeading.current;
      const fx = -Math.sin(h);
      const fz = -Math.cos(h);
      const back = 7.4 + p * 2.6;
      camTarget.set(pose.x - fx * back, 3.5 + p * 2.0, pose.z - fz * back);
      lookTarget.set(pose.x + fx * 12, 1.0 - p * 0.5, pose.z + fz * 12);
      fov = 58 + p * 16 + Math.min(1, pose.speed / 15) * 4;
    } else if (st === "menu") {
      camHeading.current = 0;
      orbit.current += dt * 0.1;
      const a = 0.75 + Math.sin(orbit.current) * 0.55;
      const r = 6.2 + p * 3.2;
      const px = pose.x;
      camTarget.set(px + Math.sin(a) * r, 1.9 + p * 0.9, Math.cos(a) * r - 0.4);
      lookTarget.set(px, 1.05 + p * 0.25, -0.3);
      fov = 50 + p * 18;
    } else {
      camHeading.current = 0;
      const px = pose.x;
      const k = Math.min(1, Math.max(0, (runtime.speed - SPEED.start) / (SPEED.max - SPEED.start)));
      camTarget.set(px * (0.55 + p * 0.2), 3.3 + p * 1.9 - k * 0.25, 7.0 + p * 2.4 - k * 0.6);
      lookTarget.set(px * 0.8, 1.1 - p * 0.6, -12 - p * 2);
      fov = 60 + p * 16 + k * 7 + runtime.boost * 2.5;
    }
    if (st === "paused") fov = camera.fov;
    const s = st === "paused" ? 0 : 1 - Math.exp(-dt * (st === "menu" ? 2.5 : 7));
    camera.position.lerp(camTarget, s);
    look.current.lerp(lookTarget, s);
    if (runtime.shake > 0.01) {
      const sh = runtime.shake * 0.35;
      camera.position.x += (Math.random() - 0.5) * sh;
      camera.position.y += (Math.random() - 0.5) * sh;
    }
    camera.lookAt(look.current);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

/** Pins DOM labels to 3D targets; mounted last so it sees this frame's positions. */
function AnchorTracker() {
  useFrame((state) => updateAnchors(state.camera, state.size.width, state.size.height));
  return null;
}

export default function GameCanvas() {
  const quality = useGameState((s) => s.quality);
  const mode = useGameState((s) => s.mode);
  const status = useGameState((s) => s.status);
  const tripId = useMissionState((s) => s.tripId);
  const destination = useMissionState((s) => s.destination);
  const high = quality === "high";
  const [dpr, setDpr] = useState(high ? 1.5 : 1);
  // The city street exists once a trip has been generated.
  const route = mode === "taxi" && tripId > 0 ? mission.route : null;
  const racing = mode === "race" && status !== "menu";
  return (
    <Canvas
      className="!absolute inset-0"
      shadows={high ? { type: PCFSoftShadowMap } : false}
      dpr={dpr}
      gl={{ antialias: high, powerPreference: "high-performance", stencil: false }}
      // near 0.25: keeps depth precision for road decals even on 16-bit depth buffers
      camera={{ fov: 60, near: 0.25, far: 2600, position: [4, 2.4, 6] }}
      onCreated={(state) => {
        // Debug handle for browser-automation testing in development.
        if (process.env.NODE_ENV !== "production")
          (window as unknown as { __toktok: unknown }).__toktok = { state, runtime, gameStore, gameActions, mission, missionStore, raceStore, raceLocal };
      }}
      fallback={
        <div className="flex h-full items-center justify-center p-6 text-center text-white" dir="rtl">
          المتصفح ده مش بيدعم WebGL.. جرّب كروم أو سفاري جديد 🙏
        </div>
      }
    >
      <PerformanceMonitor
        bounds={() => [45, 58]}
        onChange={({ factor }) => setDpr(Math.round((high ? 0.8 + factor * 1.0 : 0.6 + factor * 0.5) * 10) / 10)}
        flipflops={4}
      />
      <GameLoop />
      {mode === "taxi" && <MissionController />}
      {racing && <RaceController />}
      <CameraRig />
      {route ? (
        <>
          <MissionWorld key={tripId} route={route} destination={destination} />
          <MissionTraffic shadows={high} />
          <MissionPassenger />
        </>
      ) : (
        <>
          <BridgeEnvironment shadows={high} quality={quality} />
          {racing ? <RaceTraffic shadows={high} /> : <TrafficManager shadows={high} />}
          <OncomingTraffic />
          {racing && <RemoteRacers />}
          {racing && <RaceLines />}
          {racing && <RaceCoins />}
        </>
      )}
      <TukTuk shadows={high} pose={runtime.pose} />
      <Effects quality={quality} scrolling={!route} />
      <AnchorTracker />
    </Canvas>
  );
}
