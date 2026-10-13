import type { BufferGeometry } from "three";
import { GeoBuilder } from "./geometryKit";

/**
 * Stylized Egyptian passengers (procedural, vertex-colored, one draw call each).
 * Standing models face -z with feet at y = 0; the right arm is separate so it
 * can wave at the tuk-tuk. Seated models are built in tuk-tuk local space,
 * sitting on the passenger bench.
 */
export interface PassengerLook {
  name: string;
  skin: string;
  /** Long robe/dress color, or null for shirt + trousers. */
  robe: string | null;
  top: string;
  legs: string;
  /** Head covering: cap, hijab or none. */
  head: { kind: "kufi" | "hijab" | "cap" | "hair"; color: string };
  bag?: string;
}

export const PASSENGERS: PassengerLook[] = [
  { name: "الحاج", skin: "#8a5a3c", robe: "#9cb9d6", top: "#9cb9d6", legs: "#3a2a20", head: { kind: "kufi", color: "#f4f1ea" } },
  { name: "مدام", skin: "#c08a68", robe: "#7a3e9d", top: "#7a3e9d", legs: "#2a1d14", head: { kind: "hijab", color: "#e7a0bd" }, bag: "#3a2a20" },
  { name: "شاب", skin: "#a87050", robe: null, top: "#c8231e", legs: "#2e4a7a", head: { kind: "cap", color: "#1b1b1b" } },
  { name: "الحاجة", skin: "#9a6a48", robe: "#1d1c1e", top: "#1d1c1e", legs: "#111", head: { kind: "hijab", color: "#111114" }, bag: "#6b3a1e" },
];

function head(b: GeoBuilder, p: PassengerLook, y: number, z: number) {
  b.sphere(0.115, 0, y, z, p.skin, { w: 12, h: 10 });
  // eyes facing -z
  for (const sx of [-1, 1]) b.sphere(0.014, sx * 0.04, y + 0.02, z - 0.105, "#111", { w: 5, h: 4 });
  switch (p.head.kind) {
    case "kufi":
      b.cyl(0.105, 0.115, 0.08, 0, y + 0.075, z, p.head.color, { segments: 12 });
      b.box(0.1, 0.03, 0.025, 0, y - 0.045, z - 0.105, "#2a2a2a"); // mustache
      break;
    case "hijab":
      b.sphere(0.135, 0, y + 0.015, z + 0.02, p.head.color, { w: 12, h: 10 });
      b.cyl(0.16, 0.12, 0.16, 0, y - 0.13, z + 0.01, p.head.color, { segments: 12 });
      // face opening
      b.sphere(0.098, 0, y - 0.005, z - 0.05, p.skin, { w: 10, h: 8 });
      for (const sx of [-1, 1]) b.sphere(0.013, sx * 0.038, y + 0.015, z - 0.142, "#111", { w: 5, h: 4 });
      break;
    case "cap":
      b.sphere(0.12, 0, y + 0.04, z + 0.01, p.head.color, { w: 12, h: 6 });
      b.box(0.17, 0.02, 0.12, 0, y + 0.05, z - 0.13, p.head.color);
      break;
    default:
      b.sphere(0.12, 0, y + 0.04, z + 0.02, "#1b1b1b", { w: 12, h: 6 });
  }
}

/** Standing passenger without the right arm (returned separately). */
export function buildStandingPassenger(p: PassengerLook): { body: BufferGeometry; arm: BufferGeometry } {
  const b = new GeoBuilder();
  // shoes
  for (const sx of [-1, 1]) b.box(0.11, 0.07, 0.24, sx * 0.09, 0.035, -0.04, "#1a1410");
  if (p.robe) {
    b.cyl(0.19, 0.3, 1.2, 0, 0.66, 0, p.robe, { segments: 14 });
  } else {
    for (const sx of [-1, 1]) b.box(0.15, 0.82, 0.17, sx * 0.09, 0.47, 0, p.legs);
    b.box(0.36, 0.06, 0.22, 0, 0.89, 0, "#2a2a2a"); // belt
  }
  b.box(0.4, 0.5, 0.24, 0, 1.17, 0, p.top, { taperX: 0.92 });
  b.cyl(0.05, 0.05, 0.1, 0, 1.46, 0, p.skin, { segments: 6 });
  head(b, p, 1.6, 0);
  // left arm hanging, holding a bag if any
  b.box(0.1, 0.56, 0.11, -0.25, 1.12, 0, p.top, { rot: [0, 0, 0.06] });
  b.sphere(0.05, -0.27, 0.82, 0, p.skin, { w: 6, h: 5 });
  if (p.bag) b.box(0.08, 0.26, 0.3, -0.3, 0.68, 0, p.bag);
  const arm = new GeoBuilder();
  // pivot at the shoulder (origin), arm hangs along -y
  arm.box(0.1, 0.52, 0.11, 0, -0.26, 0, p.top);
  arm.sphere(0.05, 0, -0.55, 0, p.skin, { w: 6, h: 5 });
  return { body: b.build(), arm: arm.build() };
}

/** Shoulder pivot of the waving arm, relative to the standing model origin. */
export const ARM_PIVOT: [number, number, number] = [0.25, 1.38, 0];

/** Seated passenger on the tuk-tuk bench (tuk-tuk local coords), facing -z. */
export function buildSeatedPassenger(p: PassengerLook): BufferGeometry {
  const b = new GeoBuilder();
  const x = 0.3;
  const seatY = 1.12;
  const hipZ = 0.95;
  const legColor = p.robe ?? p.legs;
  for (const sx of [-1, 1]) {
    // thighs forward, shins down, shoes
    b.box(0.15, 0.15, 0.42, x + sx * 0.09, seatY + 0.06, hipZ - 0.2, legColor);
    b.box(0.14, 0.5, 0.15, x + sx * 0.09, seatY - 0.2, hipZ - 0.42, legColor);
    b.box(0.11, 0.07, 0.22, x + sx * 0.09, seatY - 0.47, hipZ - 0.48, "#1a1410");
  }
  b.box(0.4, 0.5, 0.24, x, seatY + 0.38, hipZ + 0.04, p.top, { taperX: 0.92 });
  b.cyl(0.05, 0.05, 0.1, x, seatY + 0.67, hipZ + 0.04, p.skin, { segments: 6 });
  head(b, p, seatY + 0.81, hipZ + 0.04);
  for (const sx of [-1, 1]) b.box(0.1, 0.4, 0.11, x + sx * 0.25, seatY + 0.3, hipZ - 0.06, p.top, { rot: [0.5, 0, 0] });
  if (p.bag) b.box(0.3, 0.24, 0.1, x, seatY + 0.18, hipZ - 0.3, p.bag);
  return b.build();
}
