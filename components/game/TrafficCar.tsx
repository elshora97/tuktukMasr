"use client";

import { useLayoutEffect, useRef } from "react";
import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial } from "three";
import type { VehicleType } from "@/lib/gameConfig";
import { getVehicleGeometries } from "@/lib/vehicleModels";

export interface TrafficTypeMeshes {
  paint: InstancedMesh;
  detail: InstancedMesh;
  lights: InstancedMesh;
  capacity: number;
}

// Shared materials across every traffic type (and oncoming traffic).
const paintMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.35 });
const detailMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 });
const lightsMaterial = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });

export const HIDDEN_MATRIX = new Matrix4().makeScale(0, 0, 0);
const WHITE = new Color(1, 1, 1);
export const LIGHT_NORMAL = new Color(0.75, 0.75, 0.75);
export const LIGHT_BRAKE = new Color(2.2, 2.2, 2.2);

/**
 * One draw call per material per vehicle type, no matter how many cars of
 * that type are on the road. Instances are positioned by the owner.
 */
export default function TrafficCar({
  type,
  capacity,
  shadows,
  onReady,
}: {
  type: VehicleType;
  capacity: number;
  shadows: boolean;
  onReady: (type: VehicleType, meshes: TrafficTypeMeshes | null) => void;
}) {
  const geo = getVehicleGeometries(type);
  const paint = useRef<InstancedMesh>(null);
  const detail = useRef<InstancedMesh>(null);
  const lights = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const p = paint.current;
    const d = detail.current;
    const l = lights.current;
    if (!p || !d || !l) return;
    for (let i = 0; i < capacity; i++) {
      p.setMatrixAt(i, HIDDEN_MATRIX);
      d.setMatrixAt(i, HIDDEN_MATRIX);
      l.setMatrixAt(i, HIDDEN_MATRIX);
      // Initialize instance colors before first compile so the shader uses them.
      p.setColorAt(i, WHITE);
      l.setColorAt(i, LIGHT_NORMAL);
    }
    p.instanceMatrix.needsUpdate = true;
    d.instanceMatrix.needsUpdate = true;
    l.instanceMatrix.needsUpdate = true;
    if (p.instanceColor) p.instanceColor.needsUpdate = true;
    if (l.instanceColor) l.instanceColor.needsUpdate = true;
    onReady(type, { paint: p, detail: d, lights: l, capacity });
    return () => onReady(type, null);
  }, [type, capacity, onReady]);

  return (
    <>
      <instancedMesh ref={paint} args={[geo.paint, paintMaterial, capacity]} castShadow={shadows} frustumCulled={false} />
      <instancedMesh ref={detail} args={[geo.detail, detailMaterial, capacity]} castShadow={shadows} frustumCulled={false} />
      <instancedMesh ref={lights} args={[geo.lights, lightsMaterial, capacity]} frustumCulled={false} />
    </>
  );
}
