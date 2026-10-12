"use client";

import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { runtime } from "@/lib/gameStore";

/**
 * Wraps a value into [maxZ - period, maxZ). Used to recycle scenery so it
 * reappears far ahead (hidden by fog) right after passing behind the camera.
 */
export function wrapZ(z0: number, distance: number, period: number, maxZ: number) {
  const m = (((z0 + distance) % period) + period) % period;
  return m + maxZ - period;
}

/**
 * Moves its children toward the camera with the world, recycling them.
 * - `spacing` mode: identical repeated children; group offset = distance mod spacing.
 * - `period` mode: unique child wraps within [maxZ - period, maxZ).
 */
export function Scroll({
  children,
  z0 = 0,
  period,
  maxZ = 35,
  spacing,
  x = 0,
  y = 0,
}: {
  children: ReactNode;
  z0?: number;
  period?: number;
  maxZ?: number;
  spacing?: number;
  x?: number;
  y?: number;
}) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    if (spacing) g.position.z = runtime.distance % spacing;
    else if (period) g.position.z = wrapZ(z0, runtime.distance, period, maxZ);
  });
  return (
    <group ref={ref} position={[x, y, period ? wrapZ(z0, runtime.distance, period, maxZ) : 0]}>
      {children}
    </group>
  );
}
