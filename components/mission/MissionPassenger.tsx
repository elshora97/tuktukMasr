"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { useMissionState } from "@/hooks/useMissionState";
import { ARM_PIVOT, PASSENGERS, buildStandingPassenger } from "@/lib/passengerModels";
import { MISSION, ROAD_HALF, STREET } from "@/lib/mission/missionConfig";
import { mission, missionStore } from "@/lib/mission/missionStore";
import { routeToWorld, type RoutePoint } from "@/lib/mission/route";

const a: RoutePoint = { x: 0, z: 0, h: 0 };
const b: RoutePoint = { x: 0, z: 0, h: 0 };
const CURB_D = ROAD_HALF + 1.3;
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * The customer: waits on the right sidewalk waving at the tuk-tuk (with a
 * bobbing marker overhead), walks to the tuk-tuk to board, and walks back to
 * the curb at the destination.
 */
export default function MissionPassenger() {
  const variant = useMissionState((s) => s.passenger);
  const tripId = useMissionState((s) => s.tripId);
  const root = useRef<Group>(null);
  const arm = useRef<Group>(null);
  const marker = useRef<Group>(null);
  const ring = useRef<Mesh>(null);

  const res = useMemo(() => {
    const look = PASSENGERS[variant % PASSENGERS.length];
    const g = buildStandingPassenger(look);
    return {
      body: g.body,
      arm: g.arm,
      mat: new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }),
      markerMat: new MeshBasicMaterial({ color: "#ffd84a", toneMapped: false }),
      ringMat: new MeshBasicMaterial({ color: "#ffd84a", transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }),
    };
    // Rebuild per trip so a new passenger look applies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, tripId]);
  useEffect(
    () => () => {
      res.body.dispose();
      res.arm.dispose();
      res.mat.dispose();
      res.markerMat.dispose();
      res.ringMat.dispose();
    },
    [res],
  );

  useFrame(({ clock }) => {
    const r = root.current;
    const route = mission.route;
    if (!r || !route) return;
    const { phase } = missionStore.getState();
    const t = clock.elapsedTime;
    let visible = true;
    let x = 0;
    let z = 0;
    let y = STREET.curbHeight;
    let yaw = 0;
    let wave = 0;
    let walking = false;
    let showMarker = false;

    const atCurb = (s: number) => {
      routeToWorld(route, s, CURB_D, a);
      x = a.x;
      z = a.z;
      yaw = a.h + Math.PI / 2; // face the road
    };

    switch (phase) {
      case "missionStart":
      case "approachingPassenger":
      case "pickupAvailable":
        atCurb(route.passengerS);
        wave = 1;
        showMarker = true;
        break;
      case "boarding": {
        // Walk from the curb to the tuk-tuk's right side, then climb in.
        const k = ease(mission.phaseT / (MISSION.boardingS * 0.8));
        routeToWorld(route, route.passengerS, CURB_D, a);
        routeToWorld(route, mission.s + 0.4, mission.d + 0.95, b);
        x = a.x + (b.x - a.x) * k;
        z = a.z + (b.z - a.z) * k;
        y = STREET.curbHeight * (1 - k);
        yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
        walking = k < 1;
        visible = mission.phaseT < MISSION.boardingS * 0.8;
        break;
      }
      case "droppingOff": {
        const k = ease((mission.phaseT - 0.25) / (MISSION.arrivingS - 0.45));
        routeToWorld(route, mission.s + 0.4, mission.d + 0.95, a);
        routeToWorld(route, mission.s + 1.5, CURB_D, b);
        x = a.x + (b.x - a.x) * k;
        z = a.z + (b.z - a.z) * k;
        y = STREET.curbHeight * k;
        yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
        walking = k > 0 && k < 1;
        visible = mission.phaseT >= 0.25;
        break;
      }
      case "completed":
        // Stays on the curb waving goodbye.
        routeToWorld(route, mission.s + 1.5, CURB_D, a);
        x = a.x;
        z = a.z;
        yaw = a.h + Math.PI / 2; // face the road
        wave = 1;
        break;
      case "failed":
        // Only visible if they never boarded.
        visible = mission.pickupStopS === 0;
        atCurb(route.passengerS);
        break;
      default:
        visible = false;
    }

    r.visible = visible;
    if (!visible) return;
    r.position.set(x, y + (walking ? Math.abs(Math.sin(t * 9)) * 0.05 : 0), z);
    r.rotation.y = yaw;
    if (arm.current) arm.current.rotation.z = wave ? 2.5 + Math.sin(t * 7) * 0.35 : walking ? Math.sin(t * 9) * 0.3 : 0.05;
    if (marker.current) {
      marker.current.visible = showMarker;
      marker.current.position.y = 2.45 + Math.sin(t * 3) * 0.12;
      marker.current.rotation.y = t * 1.5;
    }
    if (ring.current) {
      ring.current.visible = showMarker;
      const sc = 1 + (Math.sin(t * 3) + 1) * 0.15;
      ring.current.scale.set(sc, sc, sc);
    }
  });

  return (
    <group ref={root}>
      <mesh geometry={res.body} material={res.mat} castShadow />
      <group ref={arm} position={ARM_PIVOT}>
        <mesh geometry={res.arm} material={res.mat} />
      </group>
      <group ref={marker}>
        <mesh rotation={[Math.PI, 0, 0]} material={res.markerMat}>
          <coneGeometry args={[0.22, 0.45, 4]} />
        </mesh>
      </group>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} material={res.ringMat}>
        <ringGeometry args={[0.55, 0.75, 32]} />
      </mesh>
    </group>
  );
}
