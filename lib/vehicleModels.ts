import type { BufferGeometry } from "three";
import { GeoBuilder } from "./geometryKit";
import type { VehicleType } from "./gameConfig";

/**
 * Each traffic vehicle is split into three merged geometries:
 *  - paint:  white vertex colors, tinted per instance (body color)
 *  - detail: fixed vertex colors (glass, tires, bumpers, stripes, cargo)
 *  - lights: unlit; tail lights (red) + headlights (warm white)
 * Vehicles face -Z; the rear (what the player sees) is at +Z.
 */
export interface VehicleGeometries {
  paint: BufferGeometry;
  detail: BufferGeometry;
  lights: BufferGeometry;
}

const WHITE = "#ffffff";
const GLASS = "#1d2733";
const GLASS_REAR = "#26313d";
const RUBBER = "#141518";
const TRIM = "#2a2c30";
const CHROME = "#b9bec6";
const PLATE = "#e9eef2";
const TAIL = "#ff2a1a";
const HEAD = "#fff3d6";
const AMBER = "#ff9a1a";

function sedanLike(paint: GeoBuilder, detail: GeoBuilder, lights: GeoBuilder, opts: { w: number; l: number; cabinH: number; bodyH: number }) {
  const { w, l, cabinH, bodyH } = opts;
  const halfL = l / 2;
  const baseY = 0.3;
  // Lower body
  paint.box(w, bodyH, l, 0, baseY + bodyH / 2, 0, WHITE);
  // Trunk lid / hood bevels
  paint.box(w * 0.96, 0.08, l * 0.24, 0, baseY + bodyH + 0.02, halfL - l * 0.13, WHITE, { taperZ: 0.85, shiftZ: -0.04 });
  paint.box(w * 0.96, 0.08, l * 0.27, 0, baseY + bodyH + 0.02, -halfL + l * 0.15, WHITE, { taperZ: 0.85 });
  // Glass cabin + roof
  const cabinY = baseY + bodyH + cabinH / 2;
  detail.box(w * 0.88, cabinH, l * 0.5, 0, cabinY, l * 0.04, GLASS, { taperX: 0.86, taperZ: 0.66, shiftZ: 0.03 });
  paint.box(w * 0.75, 0.06, l * 0.32, 0, baseY + bodyH + cabinH + 0.02, l * 0.055, WHITE);
  // Pillars (paint) at the rear corners of the cabin
  for (const sx of [-1, 1]) {
    paint.box(0.08, cabinH * 0.98, 0.1, sx * w * 0.4, cabinY, l * 0.04 + l * 0.2, WHITE, { taperX: 0.86, shiftZ: -0.12, rot: [0, 0, 0] });
  }
  // Bumpers
  detail.box(w + 0.04, 0.2, 0.16, 0, baseY + 0.12, halfL + 0.02, TRIM);
  detail.box(w + 0.04, 0.2, 0.16, 0, baseY + 0.12, -halfL - 0.02, TRIM);
  // Plate
  detail.box(0.52, 0.15, 0.02, 0, baseY + 0.35, halfL + 0.01, PLATE);
  detail.box(0.52, 0.04, 0.021, 0, baseY + 0.405, halfL + 0.012, "#3c6fd6");
  // Mirrors
  for (const sx of [-1, 1]) detail.box(0.16, 0.1, 0.08, sx * (w / 2 + 0.07), baseY + bodyH + 0.1, -l * 0.18, TRIM);
  // Wheels
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) detail.wheel(0.33, 0.24, sx * (w / 2 - 0.1), 0.33, sz * (halfL - 0.75));
  }
  // Lights
  for (const sx of [-1, 1]) {
    lights.box(0.38, 0.15, 0.04, sx * (w / 2 - 0.24), baseY + bodyH - 0.12, halfL + 0.005, TAIL);
    lights.box(0.34, 0.13, 0.04, sx * (w / 2 - 0.24), baseY + bodyH - 0.12, -halfL - 0.005, HEAD);
  }
}

function buildSedan(): VehicleGeometries {
  const p = new GeoBuilder();
  const d = new GeoBuilder();
  const li = new GeoBuilder();
  sedanLike(p, d, li, { w: 1.78, l: 4.35, cabinH: 0.52, bodyH: 0.56 });
  return { paint: p.build(), detail: d.build(), lights: li.build() };
}

/** Cairo white taxi with black checkered side band and roof sign. */
function buildTaxi(): VehicleGeometries {
  const p = new GeoBuilder();
  const d = new GeoBuilder();
  const li = new GeoBuilder();
  const w = 1.74;
  const l = 4.25;
  sedanLike(p, d, li, { w, l, cabinH: 0.5, bodyH: 0.56 });
  // Checker band along both sides
  const squares = 12;
  const sq = (l * 0.86) / squares;
  for (let i = 0; i < squares; i++) {
    const z = -l * 0.43 + sq * (i + 0.5);
    for (const sx of [-1, 1]) {
      d.box(0.02, 0.09, sq, sx * (w / 2 + 0.006), 0.3 + 0.38 + (i % 2) * 0.09, z, "#111111");
    }
  }
  // Checker band across the trunk
  for (let i = 0; i < 8; i++) {
    const x = -w * 0.4 + ((w * 0.8) / 8) * (i + 0.5);
    d.box((w * 0.8) / 8, 0.09, 0.02, x, 0.3 + 0.62 + (i % 2) * 0.09, l / 2 + 0.006, "#111111");
  }
  // Roof sign
  d.box(0.62, 0.2, 0.26, 0, 0.3 + 0.56 + 0.5 + 0.14, 0.15, "#f6c518");
  d.box(0.5, 0.1, 0.27, 0, 0.3 + 0.56 + 0.5 + 0.14, 0.15, "#1a1a1a");
  return { paint: p.build(), detail: d.build(), lights: li.build() };
}

/** White Toyota-HiAce-style Egyptian microbus with blue stripe and roof rack. */
function buildMicrobus(): VehicleGeometries {
  const p = new GeoBuilder();
  const d = new GeoBuilder();
  const li = new GeoBuilder();
  const w = 1.98;
  const l = 5.05;
  const h = 1.62;
  const baseY = 0.34;
  p.box(w, h, l, 0, baseY + h / 2, 0, WHITE, { taperX: 0.94, taperZ: 0.93, shiftZ: 0.16 });
  // Side windows (glass strip)
  for (const sx of [-1, 1]) {
    d.box(0.02, 0.5, l * 0.7, sx * (w / 2 - 0.035), baseY + h * 0.72, 0.25, GLASS, { rot: [0, 0, sx * 0.04] });
    // Blue + red stripes
    d.box(0.02, 0.13, l * 0.96, sx * (w / 2 + 0.004), baseY + h * 0.38, 0.05, "#1f57b8");
    d.box(0.02, 0.05, l * 0.96, sx * (w / 2 + 0.004), baseY + h * 0.3, 0.05, "#c8231e");
    // Sliding door seam
    d.box(0.021, h * 0.75, 0.03, sx * (w / 2 + 0.004), baseY + h * 0.45, -0.6, "#9aa0a6");
  }
  // Rear window and stripe
  d.box(w * 0.78, 0.5, 0.02, 0, baseY + h * 0.74, l / 2 + 0.17 * 0 + 0.012, GLASS_REAR, { taperX: 1 });
  d.box(w * 0.98, 0.13, 0.02, 0, baseY + h * 0.38, l / 2 + 0.01, "#1f57b8");
  // Front windshield
  d.box(w * 0.82, 0.6, 0.02, 0, baseY + h * 0.72, -l / 2 + 0.2, GLASS, { rot: [-0.25, 0, 0] });
  // Bumpers + plate
  d.box(w + 0.04, 0.22, 0.16, 0, baseY + 0.08, l / 2 + 0.03, TRIM);
  d.box(w + 0.04, 0.22, 0.16, 0, baseY + 0.08, -l / 2 - 0.03, TRIM);
  d.box(0.52, 0.15, 0.02, 0, baseY + 0.32, l / 2 + 0.012, PLATE);
  d.box(0.52, 0.04, 0.021, 0, baseY + 0.375, l / 2 + 0.014, "#c8a21e");
  // Roof rack with luggage
  for (const sx of [-1, 1]) d.box(0.05, 0.05, l * 0.8, sx * w * 0.42, baseY + h + 0.14, 0.15, "#3a3d42");
  for (let i = 0; i < 5; i++) d.box(w * 0.86, 0.04, 0.05, 0, baseY + h + 0.14, -l * 0.3 + i * l * 0.17, "#3a3d42");
  d.box(0.8, 0.32, 0.7, -0.25, baseY + h + 0.32, 0.6, "#5a3f2a");
  d.box(0.6, 0.28, 0.55, 0.38, baseY + h + 0.3, -0.2, "#2d4f86");
  // Rear ladder
  for (const sx of [-0.3, 0.3]) d.box(0.035, h * 0.9, 0.035, sx + 0.55, baseY + h * 0.55, l / 2 + 0.05, CHROME);
  // Wheels
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) d.wheel(0.34, 0.24, sx * (w / 2 - 0.12), 0.34, sz * (l / 2 - 0.85));
  }
  // Tall vertical tail lights
  for (const sx of [-1, 1]) {
    li.box(0.14, 0.42, 0.04, sx * (w / 2 - 0.1), baseY + 0.5, l / 2 + 0.005, TAIL);
    li.box(0.14, 0.12, 0.041, sx * (w / 2 - 0.1), baseY + 0.78, l / 2 + 0.006, AMBER);
    li.box(0.3, 0.16, 0.04, sx * (w / 2 - 0.28), baseY + 0.55, -l / 2 - 0.005, HEAD);
  }
  return { paint: p.build(), detail: d.build(), lights: li.build() };
}

function buildSUV(): VehicleGeometries {
  const p = new GeoBuilder();
  const d = new GeoBuilder();
  const li = new GeoBuilder();
  const w = 1.96;
  const l = 4.7;
  const baseY = 0.42;
  const bodyH = 0.78;
  p.box(w, bodyH, l, 0, baseY + bodyH / 2, 0, WHITE);
  p.box(w * 0.96, 0.1, l * 0.24, 0, baseY + bodyH + 0.03, -l / 2 + l * 0.13, WHITE, { taperZ: 0.8 });
  const cabinH = 0.66;
  d.box(w * 0.92, cabinH, l * 0.6, 0, baseY + bodyH + cabinH / 2, l * 0.1, GLASS, { taperX: 0.92, taperZ: 0.85, shiftZ: 0.08 });
  p.box(w * 0.86, 0.07, l * 0.52, 0, baseY + bodyH + cabinH + 0.03, l * 0.14, WHITE);
  for (const sx of [-1, 1]) {
    p.box(0.1, cabinH, 0.14, sx * w * 0.43, baseY + bodyH + cabinH / 2, l * 0.39, WHITE, { taperX: 0.92 });
    d.box(0.05, 0.05, l * 0.5, sx * w * 0.36, baseY + bodyH + cabinH + 0.1, l * 0.14, "#2b2d31");
    // Plastic wheel arches
    d.box(0.06, 0.22, 1.0, sx * (w / 2 + 0.02), baseY + 0.12, l / 2 - 0.85, "#222");
    d.box(0.06, 0.22, 1.0, sx * (w / 2 + 0.02), baseY + 0.12, -l / 2 + 0.85, "#222");
  }
  d.box(w + 0.06, 0.24, 0.18, 0, baseY + 0.05, l / 2 + 0.03, "#2a2c30");
  d.box(w + 0.06, 0.24, 0.18, 0, baseY + 0.05, -l / 2 - 0.03, "#2a2c30");
  d.box(0.52, 0.15, 0.02, 0, baseY + 0.32, l / 2 + 0.012, PLATE);
  d.box(0.52, 0.04, 0.021, 0, baseY + 0.375, l / 2 + 0.014, "#3c6fd6");
  // Spare tire on the tailgate
  d.cyl(0.36, 0.36, 0.22, 0.25, baseY + 0.62, l / 2 + 0.12, RUBBER, { rot: [Math.PI / 2, 0, 0], segments: 14 });
  d.cyl(0.24, 0.24, 0.23, 0.25, baseY + 0.62, l / 2 + 0.12, "#5c6066", { rot: [Math.PI / 2, 0, 0], segments: 10 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) d.wheel(0.4, 0.28, sx * (w / 2 - 0.12), 0.4, sz * (l / 2 - 0.85));
  }
  for (const sx of [-1, 1]) {
    li.box(0.14, 0.34, 0.04, sx * (w / 2 - 0.08), baseY + bodyH - 0.2, l / 2 + 0.005, TAIL);
    li.box(0.38, 0.14, 0.04, sx * (w / 2 - 0.3), baseY + bodyH - 0.14, -l / 2 - 0.005, HEAD);
  }
  return { paint: p.build(), detail: d.build(), lights: li.build() };
}

/** Small "ربع نقل" pickup loaded with watermelons. */
function buildPickup(): VehicleGeometries {
  const p = new GeoBuilder();
  const d = new GeoBuilder();
  const li = new GeoBuilder();
  const w = 1.7;
  const l = 4.15;
  const baseY = 0.36;
  // Chassis
  d.box(w * 0.9, 0.18, l * 0.95, 0, baseY + 0.05, 0, "#222326");
  // Cab
  const cabZ = -l / 2 + 0.85;
  p.box(w, 0.55, 1.7, 0, baseY + 0.42, cabZ, WHITE);
  p.box(w, 0.75, 1.15, 0, baseY + 0.42 + 0.27 + 0.37, cabZ + 0.22, WHITE, { taperX: 0.92, taperZ: 0.85, shiftZ: 0.05 });
  d.box(w * 0.8, 0.45, 0.02, 0, baseY + 1.1, cabZ + 0.81, GLASS_REAR);
  d.box(w * 0.82, 0.5, 0.02, 0, baseY + 1.05, cabZ - 0.36, GLASS, { rot: [-0.25, 0, 0] });
  for (const sx of [-1, 1]) d.box(0.02, 0.42, 0.75, sx * (w * 0.46 + 0.01), baseY + 1.08, cabZ + 0.2, GLASS);
  // Bed with low walls
  const bedL = l - 1.75;
  const bedZ = l / 2 - bedL / 2;
  d.box(w, 0.08, bedL, 0, baseY + 0.32, bedZ, "#2a2a2a");
  for (const sx of [-1, 1]) p.box(0.06, 0.45, bedL, sx * (w / 2 - 0.03), baseY + 0.58, bedZ, WHITE);
  p.box(w, 0.45, 0.06, 0, baseY + 0.58, l / 2 - 0.03, WHITE);
  // Watermelons
  const melonDark = "#1f4a1c";
  const melonLight = "#3d7a2e";
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x = -0.48 + col * 0.48;
      const z = bedZ - bedL / 2 + 0.38 + row * 0.62;
      d.sphere(0.24, x, baseY + 0.62, z, (row + col) % 2 ? melonDark : melonLight, { w: 8, h: 6 });
    }
  }
  for (let i = 0; i < 4; i++) {
    d.sphere(0.23, -0.24 + (i % 2) * 0.48, baseY + 0.98, bedZ - 0.35 + Math.floor(i / 2) * 0.62, i % 2 ? melonLight : melonDark, { w: 8, h: 6 });
  }
  d.box(w + 0.04, 0.18, 0.14, 0, baseY + 0.06, l / 2 + 0.02, TRIM);
  d.box(0.5, 0.15, 0.02, 0, baseY + 0.42, l / 2 + 0.012, PLATE);
  d.box(0.5, 0.04, 0.021, 0, baseY + 0.475, l / 2 + 0.014, "#c8231e");
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) d.wheel(0.32, 0.22, sx * (w / 2 - 0.1), 0.32, sz * (l / 2 - 0.7));
    li.box(0.12, 0.26, 0.04, sx * (w / 2 - 0.08), baseY + 0.55, l / 2 + 0.005, TAIL);
    li.box(0.3, 0.14, 0.04, sx * (w / 2 - 0.25), baseY + 0.5, -l / 2 - 0.005, HEAD);
  }
  return { paint: p.build(), detail: d.build(), lights: li.build() };
}

const builders: Record<VehicleType, () => VehicleGeometries> = {
  taxi: buildTaxi,
  sedan: buildSedan,
  microbus: buildMicrobus,
  suv: buildSUV,
  pickup: buildPickup,
};

const cache = new Map<VehicleType, VehicleGeometries>();

/** Geometries are cached and shared across all instanced meshes. */
export function getVehicleGeometries(type: VehicleType): VehicleGeometries {
  let g = cache.get(type);
  if (!g) {
    g = builders[type]();
    cache.set(type, g);
  }
  return g;
}
