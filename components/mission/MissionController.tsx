"use client";

import { useFrame } from "@react-three/fiber";
import { PLAYER } from "@/lib/gameConfig";
import { gameStore, runtime } from "@/lib/gameStore";
import { audio } from "@/lib/audio";
import { MISSION } from "@/lib/mission/missionConfig";
import { MAX_D, inDropZone, inPickupZone, isStopped, mission, missionActions, missionActive, missionStore } from "@/lib/mission/missionStore";
import { routeToWorld, type RoutePoint } from "@/lib/mission/route";

const pt: RoutePoint = { x: 0, z: 0, h: 0 };

/** Phases where the tuk-tuk is held still and steering is locked. */
const LOCKED = new Set(["boarding", "droppingOff", "completed", "failed"]);

/**
 * Drives the passenger mission: movement along the route (auto-cruise with a
 * held brake), steering in route space, and the mission state machine.
 * Traffic + collisions live in MissionTraffic; visuals read `mission` / pose.
 */
export default function MissionController() {
  useFrame((_, rawDt) => {
    const g = gameStore.getState();
    if (g.mode !== "taxi") return;
    const route = mission.route;
    if (!route) return;
    const dt = Math.min(rawDt, 0.05);
    const pose = runtime.pose;

    if (runtime.hornRequested) {
      runtime.hornRequested = false;
      if (g.status !== "paused") audio.horn();
    }
    if (g.status === "paused") {
      audio.update(0, "silent", dt);
      return;
    }

    const ms = missionStore.getState();
    const phase = ms.phase;
    mission.phaseT += dt;

    // Crash: tip-over animation, then the failure screen (set by MissionTraffic).
    if (runtime.crashT >= 0) {
      runtime.crashT += dt;
      pose.crashT = runtime.crashT;
      mission.speed *= Math.exp(-dt * 6);
      pose.speed = mission.speed;
      runtime.shake *= Math.exp(-dt * 3.5);
      audio.update(mission.speed, "silent", dt);
      return;
    }

    // --- Speed: cruise unless braking; held still while (un)boarding.
    const locked = LOCKED.has(phase);
    if (locked) mission.speed = Math.max(0, mission.speed - MISSION.brakeDecel * 1.5 * dt);
    else if (runtime.brake) mission.speed = Math.max(0, mission.speed - MISSION.brakeDecel * dt);
    else mission.speed = Math.min(MISSION.cruiseSpeed, mission.speed + MISSION.accel * dt);
    mission.s = Math.min(route.length - 1, mission.s + mission.speed * dt);

    // --- Steering in route space (d). Authority fades when nearly stopped.
    const held = Math.max(-1, Math.min(1, runtime.keySteer + runtime.padSteer));
    if (held !== 0) runtime.targetX += held * PLAYER.keyboardSteerSpeed * dt;
    runtime.targetX = Math.max(-MAX_D, Math.min(MAX_D, runtime.targetX));
    if (!locked) {
      const authority = Math.max(MISSION.minSteerFactor, Math.min(1, mission.speed / 10));
      const maxLat = PLAYER.maxLateralSpeed * authority;
      const v = Math.max(-maxLat, Math.min(maxLat, (runtime.targetX - mission.d) * PLAYER.followSharpness));
      mission.d += v * dt;
    } else {
      runtime.targetX = mission.d;
    }

    if (missionActive(phase)) mission.time += dt;

    // --- State machine
    const stopped = isStopped(mission.speed);
    switch (phase) {
      case "missionStart":
        if (mission.phaseT > 2.2) missionActions.setPhase("approachingPassenger");
      // falls through — zone checks apply from the very start
      case "approachingPassenger":
        mission.inZone = inPickupZone(mission.s, mission.d, route.passengerS);
        if (mission.inZone) missionActions.setPhase("pickupAvailable");
        else if (mission.s > route.passengerS + MISSION.missAfter) missionActions.fail("missedPassenger");
        break;
      case "pickupAvailable":
        mission.inZone = inPickupZone(mission.s, mission.d, route.passengerS);
        if (!mission.inZone) {
          if (mission.s > route.passengerS + MISSION.missAfter) missionActions.fail("missedPassenger");
          else missionActions.setPhase("approachingPassenger");
        } else if (stopped) {
          mission.holdT += dt;
          if (mission.holdT >= MISSION.holdS) {
            mission.pickupStopS = mission.s;
            missionActions.setPhase("boarding");
            audio.overtake(false);
          }
        } else {
          mission.holdT = 0;
        }
        break;
      case "boarding":
        mission.inZone = false;
        if (mission.phaseT >= MISSION.boardingS) {
          missionActions.setPhase("passengerOnboard");
          audio.overtake(true);
        }
        break;
      case "passengerOnboard":
        if (mission.phaseT >= MISSION.dialogueS) missionActions.setPhase("navigating");
      // falls through — the drop-off can't be missed while the dialogue shows
      case "navigating":
        mission.inZone = inDropZone(mission.s, mission.d, route.dropS);
        if (mission.inZone && phase === "navigating") missionActions.setPhase("arriving");
        else if (mission.s > route.dropS + MISSION.dropHalf + 3) missionActions.fail("missedDrop");
        break;
      case "arriving":
        mission.inZone = inDropZone(mission.s, mission.d, route.dropS);
        if (!mission.inZone) {
          if (mission.s > route.dropS + MISSION.dropHalf + 3) missionActions.fail("missedDrop");
          else missionActions.setPhase("navigating");
        } else if (stopped) {
          mission.holdT += dt;
          if (mission.holdT >= MISSION.holdS) missionActions.setPhase("droppingOff");
        } else {
          mission.holdT = 0;
        }
        break;
      case "droppingOff":
        mission.inZone = false;
        if (mission.phaseT >= MISSION.arrivingS) {
          missionActions.complete();
          audio.fanfare();
        }
        break;
      default:
        break;
    }
    if (missionActive(missionStore.getState().phase) && mission.time > ms.timeLimit) {
      missionActions.fail("timeout");
      audio.horn({ gain: 0.18, pitch: 0.8, beeps: 3 });
    }

    // --- Publish pose for the tuk-tuk, camera, sun and effects.
    routeToWorld(route, mission.s, mission.d, pt);
    pose.x = pt.x;
    pose.z = pt.z;
    pose.heading = pt.h;
    pose.speed = mission.speed;
    pose.crashT = -1;
    const p = missionStore.getState().phase;
    const seated =
      (p === "boarding" && mission.phaseT > MISSION.boardingS * 0.8) ||
      p === "passengerOnboard" ||
      p === "navigating" ||
      p === "arriving" ||
      (p === "droppingOff" && mission.phaseT < 0.25);
    pose.passenger = seated ? missionStore.getState().passenger : -1;
    runtime.speed = mission.speed;
    runtime.playerX = mission.d;
    audio.update(Math.max(mission.speed, 9), missionActive(p) ? "playing" : "menu", dt);
  });
  return null;
}
