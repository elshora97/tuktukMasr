"use client";

import { useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { PCFSoftShadowMap, PerspectiveCamera, Vector3 } from "three";
import { PLAYER, SPEED, playerSpeedFor } from "@/lib/gameConfig";
import { gameActions, gameStore, runtime } from "@/lib/gameStore";
import { audio } from "@/lib/audio";
import { useGameState } from "@/hooks/useGameState";
import TukTuk from "./TukTuk";
import TrafficManager, { OncomingTraffic } from "./TrafficManager";
import BridgeEnvironment from "./BridgeEnvironment";
import Effects from "./Effects";

/** Delay after impact before the game-over overlay appears (crash animation). */
const CRASH_REVEAL_S = 1.15;

/** Core simulation: speed, distance, steering, crash timeline, audio. */
function GameLoop() {
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const st = gameStore.getState();
    const status = st.status;

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
  });
  return null;
}

const camTarget = new Vector3();
const lookTarget = new Vector3();

function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const look = useRef(new Vector3(0, 1, -12));
  const orbit = useRef(0.9);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const st = gameStore.getState().status;
    const aspect = size.width / Math.max(1, size.height);
    // 0 = landscape, 1 = tall portrait phone
    const p = Math.min(1, Math.max(0, (1.25 - aspect) / 0.75));
    const px = runtime.crashT >= 0 ? runtime.crashX : runtime.playerX;
    let fov: number;
    if (st === "menu") {
      orbit.current += dt * 0.1;
      const a = 0.75 + Math.sin(orbit.current) * 0.55;
      const r = 6.2 + p * 3.2;
      camTarget.set(px + Math.sin(a) * r, 1.9 + p * 0.9, Math.cos(a) * r - 0.4);
      lookTarget.set(px, 1.05 + p * 0.25, -0.3);
      fov = 50 + p * 18;
    } else {
      const k = Math.min(1, Math.max(0, (runtime.speed - SPEED.start) / (SPEED.max - SPEED.start)));
      camTarget.set(px * (0.55 + p * 0.2), 3.3 + p * 1.9 - k * 0.25, 7.0 + p * 2.4 - k * 0.6);
      lookTarget.set(px * 0.8, 1.1 - p * 0.6, -12 - p * 2);
      fov = 60 + p * 16 + k * 7 + runtime.boost * 2.5;
      if (st === "paused") fov = camera.fov;
    }
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

export default function GameCanvas() {
  const quality = useGameState((s) => s.quality);
  const high = quality === "high";
  const [dpr, setDpr] = useState(high ? 1.5 : 1);
  return (
    <Canvas
      key={quality}
      className="!absolute inset-0"
      shadows={high ? { type: PCFSoftShadowMap } : false}
      dpr={dpr}
      gl={{ antialias: high, powerPreference: "high-performance", stencil: false }}
      camera={{ fov: 60, near: 0.1, far: 2600, position: [4, 2.4, 6] }}
      onCreated={(state) => {
        // Debug handle for browser-automation testing in development.
        if (process.env.NODE_ENV !== "production") (window as unknown as { __toktok: unknown }).__toktok = { state, runtime, gameStore, gameActions };
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
      <CameraRig />
      <BridgeEnvironment shadows={high} quality={quality} />
      <TrafficManager shadows={high} />
      <OncomingTraffic />
      <TukTuk shadows={high} />
      <Effects quality={quality} />
    </Canvas>
  );
}
