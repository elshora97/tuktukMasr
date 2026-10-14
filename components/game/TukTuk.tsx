"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Shape,
  TorusGeometry,
  type Texture,
} from "three";
import { GeoBuilder, extrudeProfile } from "@/lib/geometryKit";
import { createTukTukRearTexture, createTukTukSideTexture, getSoftDotTexture } from "@/lib/textures";
import type { TukTukPose } from "@/lib/gameStore";
import { PASSENGERS, buildSeatedPassenger } from "@/lib/passengerModels";
import { PLAYER } from "@/lib/gameConfig";

/*
 * Procedural Bajaj RE — the three-wheeler that fills Egyptian streets.
 * Built from extruded side profiles (z/y plane) so the body has the real
 * silhouette: tapered nose cowl with a central headlight, upright curved
 * windshield, rounded roof with a front visor, low driver opening, rear wheel
 * arches, and a canvas back with a plastic window. Egyptian customizations on
 * top: two-tone paint with stripes, chrome tubes, roof fringe, bumper sticker,
 * evil-eye charm.
 *
 * Local axes: x = right, y = up, -z = forward. Rear (camera side) at +z.
 */

/** Paint schemes: the player's classic red, plus distinct colors for other racers. */
export const TUKTUK_PAINTS = [
  { main: "#b3121f", dark: "#7c0b15" },
  { main: "#1d4fa8", dark: "#12336e" },
  { main: "#13866f", dark: "#0b5a4a" },
  { main: "#e0a019", dark: "#9c6c0c" },
  { main: "#6b2c91", dark: "#47195f" },
  { main: "#1c1c1c", dark: "#000000" },
] as const;
const YELLOW = "#f6c21c";
const TEAL = "#18a39a";
const BLACK = "#151515";
const CANVAS = "#1d1c1b";
const CHROME = "#d7dce2";
const SKIN = "#8a5a3c";
const FRINGE = ["#f6c21c", "#e2253a", "#18a39a", "#2f6fd6", "#ff7ab8", "#ffffff"];

export const REAR_WHEEL_Z = 0.85;
export const REAR_WHEEL_X = 0.6;
export const REAR_WHEEL_R = 0.3;
export const FRONT_WHEEL_Z = -1.2;
export const FRONT_WHEEL_R = 0.27;

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));

/** Front cowl: narrow, rounded nose that widens into the dashboard. */
function cowlShape() {
  const s = new Shape();
  s.moveTo(-0.96, 0.5);
  s.lineTo(-1.28, 0.62);
  s.quadraticCurveTo(-1.46, 0.68, -1.46, 0.9);
  s.quadraticCurveTo(-1.44, 1.18, -1.24, 1.26);
  s.lineTo(-0.94, 1.28);
  s.lineTo(-0.9, 1.2);
  s.lineTo(-0.9, 0.5);
  s.closePath();
  return s;
}

/** Side panel: low driver opening, waistline, wheel arch, tall rear quarter. */
function sidePanelShape() {
  const s = new Shape();
  s.moveTo(-0.95, 0.42);
  s.lineTo(0.47, 0.42);
  s.absarc(REAR_WHEEL_Z, 0.3, 0.4, Math.PI - 0.3, 0.3, true);
  s.lineTo(1.3, 0.42);
  s.lineTo(1.3, 1.72);
  s.quadraticCurveTo(1.3, 1.84, 1.14, 1.84);
  s.lineTo(0.92, 1.84);
  s.quadraticCurveTo(0.8, 1.42, 0.7, 1.0);
  s.lineTo(0.02, 0.97);
  s.quadraticCurveTo(-0.32, 0.96, -0.5, 0.74);
  s.lineTo(-0.8, 0.72);
  s.quadraticCurveTo(-0.95, 0.74, -0.95, 0.98);
  s.closePath();
  return s;
}

/** Rear engine cover / bumper panel (rounded). */
function rearPanelShape() {
  const s = new Shape();
  s.moveTo(1.16, 0.4);
  s.lineTo(1.32, 0.4);
  s.quadraticCurveTo(1.39, 0.42, 1.39, 0.58);
  s.lineTo(1.37, 1.12);
  s.lineTo(1.2, 1.12);
  s.closePath();
  return s;
}

/** Roof shell: front visor, flat top, rounded rear. */
function roofShape() {
  const s = new Shape();
  s.moveTo(-1.2, 1.84);
  s.quadraticCurveTo(-1.02, 2.01, -0.6, 2.03);
  s.lineTo(0.96, 2.03);
  s.quadraticCurveTo(1.34, 2.02, 1.34, 1.78);
  s.lineTo(1.28, 1.78);
  s.quadraticCurveTo(1.28, 1.97, 0.95, 1.98);
  s.lineTo(-0.6, 1.98);
  s.quadraticCurveTo(-0.98, 1.96, -1.13, 1.82);
  s.closePath();
  return s;
}

/** Curved arc segment (windshield glass / frame), bulging toward -z. */
function arcSegment(radius: number, height: number, halfAngle: number, openEnded = true) {
  return new CylinderGeometry(radius, radius, height, 18, 1, openEnded, Math.PI - halfAngle, halfAngle * 2);
}

const WS_R = 1.05;
const WS_HALF = 0.47;
const WS_CENTER_Z = -1.12 + WS_R;

function buildBody(RED: string, RED_DARK: string) {
  const b = new GeoBuilder();
  // Floor pan
  b.box(1.24, 0.08, 2.3, 0, 0.46, 0.15, "#222");
  // Nose cowl, tapering toward the front
  b.geom(
    extrudeProfile(cowlShape(), 1.02, { bevel: 0.05, taper: (z) => (z < -0.96 ? lerp(1, 0.58, (-0.96 - z) / 0.5) : 1) }),
    RED,
  );
  // Yellow + teal pinstripe around the nose
  b.geom(extrudeProfile(cowlStripe(), 1.04, { bevel: 0.01, taper: (z) => (z < -0.96 ? lerp(1, 0.6, (-0.96 - z) / 0.5) : 1) }), YELLOW);
  // Side panels
  for (const sx of [-1, 1]) {
    b.geom(extrudeProfile(sidePanelShape(), 0.05, { bevel: 0.012 }), RED, sx * 0.655, 0, 0);
    // Body stripes (yellow over teal) along the lower panel, front of the arch
    b.box(0.012, 0.05, 1.32, sx * 0.686, 0.62, -0.23, YELLOW);
    b.box(0.012, 0.025, 1.32, sx * 0.686, 0.575, -0.23, TEAL);
    // Chrome waist trim
    b.box(0.014, 0.025, 0.7, sx * 0.686, 0.95, 0.35, CHROME);
    // Black rubber edge on the driver opening
    b.box(0.07, 0.03, 0.32, sx * 0.655, 0.74, -0.65, BLACK);
    // Rear fender lip over the wheel arch
    b.geom(new TorusGeometry(0.41, 0.03, 6, 18, Math.PI - 0.6), RED_DARK, sx * 0.69, 0.3, REAR_WHEEL_Z, {
      rot: [0, Math.PI / 2, 0.3],
    });
    // Mud flap behind the rear wheel
    b.box(0.2, 0.26, 0.02, sx * REAR_WHEEL_X, 0.28, 1.24, BLACK);
    // Chrome B-pillar tube (front of passenger compartment) and A-pillar
    b.cyl(0.024, 0.024, 1.04, sx * 0.665, 1.47, 0.02, CHROME, { segments: 8 });
    b.cyl(0.022, 0.022, 0.72, sx * 0.49, 1.6, -1.04, BLACK, { segments: 6, rot: [0.08, 0, 0] });
    // Side mirrors on stalks
    b.cyl(0.012, 0.012, 0.32, sx * 0.62, 1.42, -1.02, BLACK, { segments: 5, rot: [0, 0, sx * 1.1] });
    b.cyl(0.08, 0.08, 0.03, sx * 0.76, 1.52, -1.03, BLACK, { segments: 12, rot: [Math.PI / 2, 0, 0] });
    b.cyl(0.065, 0.065, 0.031, sx * 0.76, 1.52, -1.035, "#9fb4c4", { segments: 12, rot: [Math.PI / 2, 0, 0] });
    // Rear quarter: small side window frame accent
    b.box(0.013, 0.03, 0.34, sx * 0.686, 1.3, 1.1, CHROME);
    // Driver's arms reaching to the handlebar
    b.box(0.1, 0.1, 0.42, sx * 0.24, 1.38, -0.55, "#2f6fb0", { rot: [0.32, sx * -0.12, 0] });
  }
  // Rear panel + chrome rear guard bar
  b.geom(extrudeProfile(rearPanelShape(), 1.36, { bevel: 0.04 }), RED);
  b.cyl(0.03, 0.03, 1.2, 0, 0.5, 1.5, CHROME, { rot: [0, 0, Math.PI / 2], segments: 8 });
  for (const sx of [-1, 1]) b.cyl(0.025, 0.025, 0.1, sx * 0.5, 0.5, 1.45, CHROME, { rot: [Math.PI / 2, 0, 0], segments: 6 });
  // Rear canvas with an opening for the plastic window
  b.box(1.34, 0.18, 0.04, 0, 1.21, 1.29, CANVAS);
  b.box(1.34, 0.12, 0.04, 0, 1.76, 1.29, CANVAS);
  for (const sx of [-1, 1]) b.box(0.25, 0.48, 0.04, sx * 0.545, 1.5, 1.29, CANVAS);
  // Roof (black canvas hard-top) with yellow drip rail
  b.geom(extrudeProfile(roofShape(), 1.44, { bevel: 0.04 }), BLACK);
  b.geom(extrudeProfile(roofRail(), 1.47, { bevel: 0.01 }), YELLOW);
  // Windshield frame: curved top and bottom rails + wiper
  b.geom(arcSegment(WS_R + 0.01, 0.05, WS_HALF + 0.02, false), BLACK, 0, 1.3, WS_CENTER_Z);
  b.geom(arcSegment(WS_R + 0.01, 0.04, WS_HALF + 0.02, false), BLACK, 0, 1.9, WS_CENTER_Z);
  b.box(0.42, 0.015, 0.015, 0.12, 1.42, -1.135, BLACK, { rot: [0, 0, 0.5] });
  // Headlight bezel, horn, front plate
  b.cyl(0.15, 0.13, 0.12, 0, 1.0, -1.43, CHROME, { rot: [Math.PI / 2, 0, 0], segments: 16 });
  b.cyl(0.05, 0.07, 0.08, 0.2, 0.82, -1.4, CHROME, { rot: [Math.PI / 2, 0, 0], segments: 10 });
  b.box(0.36, 0.13, 0.02, 0, 0.72, -1.475, "#f4f4ee", { rot: [-0.25, 0, 0] });
  b.box(0.36, 0.035, 0.021, 0, 0.775, -1.462, "#e07a1f", { rot: [-0.25, 0, 0] });
  // Dashboard + speedo pod
  b.box(0.86, 0.1, 0.3, 0, 1.26, -0.86, "#222");
  b.cyl(0.07, 0.07, 0.06, 0, 1.33, -0.84, "#2a2a2a", { rot: [0.9, 0, 0], segments: 10 });
  // Passenger bench + velvet backrest (classic maroon), driver seat
  b.box(1.16, 0.16, 0.48, 0, 1.02, 0.86, "#3a1d14");
  b.box(1.16, 0.5, 0.12, 0, 1.32, 1.14, "#6a1736");
  b.box(1.18, 0.04, 0.13, 0, 1.58, 1.14, YELLOW);
  b.box(0.54, 0.12, 0.4, 0, 1.0, -0.3, "#222");
  b.box(0.5, 0.36, 0.08, 0, 1.2, -0.08, "#2a2a2a");
  // Grab bar behind the driver
  b.cyl(0.02, 0.02, 1.3, 0, 1.5, 0.02, CHROME, { rot: [0, 0, Math.PI / 2], segments: 8 });
  // Driver: torso, neck, head with short black hair
  b.box(0.48, 0.54, 0.3, 0, 1.33, -0.3, "#2f6fb0", { taperX: 0.9 });
  b.cyl(0.06, 0.06, 0.1, 0, 1.64, -0.32, SKIN, { segments: 6 });
  b.sphere(0.14, 0, 1.79, -0.33, SKIN, { w: 12, h: 10 });
  // Short black hair: a flattened cap set back on the head
  b.sphere(0.142, 0, 1.85, -0.27, "#1b1b1b", { w: 12, h: 8 });
  // Face: eyes and a proper Egyptian mustache
  for (const sx of [-1, 1]) b.sphere(0.018, sx * 0.05, 1.81, -0.462, "#111", { w: 6, h: 4 });
  b.box(0.11, 0.025, 0.03, 0, 1.75, -0.465, "#1b1b1b");
  b.box(0.16, 0.05, 0.03, 0, 1.73, -0.2, "#1b1b1b");
  // Exhaust
  b.cyl(0.045, 0.045, 0.36, -0.42, 0.34, 1.3, CHROME, { rot: [Math.PI / 2, 0, 0], segments: 8 });
  return b.build();
}

function cowlStripe() {
  const s = new Shape();
  s.moveTo(-0.95, 0.66);
  s.lineTo(-1.42, 0.74);
  s.lineTo(-1.43, 0.79);
  s.lineTo(-0.95, 0.71);
  s.closePath();
  return s;
}

function roofRail() {
  const s = new Shape();
  s.moveTo(-1.2, 1.83);
  s.lineTo(1.34, 1.77);
  s.lineTo(1.34, 1.73);
  s.lineTo(-1.2, 1.79);
  s.closePath();
  return s;
}

function buildGlass() {
  const b = new GeoBuilder();
  // Upright, horizontally-curved Bajaj windshield
  b.geom(arcSegment(WS_R, 0.6, WS_HALF), "#ffffff", 0, 1.6, WS_CENTER_Z);
  // Plastic rear window in the canvas
  b.box(0.84, 0.48, 0.01, 0, 1.5, 1.295, "#ffffff");
  // Small side windows in the rear quarters
  for (const sx of [-1, 1]) b.box(0.01, 0.34, 0.26, sx * 0.684, 1.5, 1.1, "#ffffff");
  return b.build();
}

function buildFringe() {
  const b = new GeoBuilder();
  let k = 0;
  const add = (x: number, y: number, z: number) => {
    b.cyl(0.02, 0.004, 0.1, x, y, z, FRINGE[k++ % FRINGE.length], { segments: 4 });
  };
  for (let x = -0.68; x <= 0.69; x += 0.07) {
    add(x, 1.76, -1.17);
    add(x, 1.71, 1.34);
  }
  for (let z = -1.08; z <= 1.25; z += 0.085) {
    const y = 1.8 - ((z + 1.2) / 2.5) * 0.06;
    add(-0.74, y, z);
    add(0.74, y, z);
  }
  return b.build();
}

function buildWheel(r: number, w: number) {
  const b = new GeoBuilder();
  b.cyl(r, r, w, 0, 0, 0, "#141414", { rot: [0, 0, Math.PI / 2], segments: 18 });
  b.cyl(r * 0.78, r * 0.78, w + 0.004, 0, 0, 0, "#262626", { rot: [0, 0, Math.PI / 2], segments: 18 });
  b.cyl(r * 0.55, r * 0.55, w + 0.02, 0, 0, 0, "#c9ced4", { rot: [0, 0, Math.PI / 2], segments: 12 });
  // Painted hub "spokes" so the spin reads on camera
  for (let i = 0; i < 3; i++) b.box(w + 0.03, 0.05, r * 1.05, 0, 0, 0, "#9c1422", { rot: [(i * Math.PI) / 3, 0, 0] });
  b.cyl(r * 0.16, r * 0.16, w + 0.05, 0, 0, 0, CHROME, { rot: [0, 0, Math.PI / 2], segments: 8 });
  return b.build();
}

/** Front fork + steering-linked mudguard (rotates with the handlebar). */
function buildFrontFork(RED: string) {
  const b = new GeoBuilder();
  for (const sx of [-1, 1]) b.cyl(0.026, 0.026, 0.42, sx * 0.1, 0.46, 0.02, CHROME, { segments: 6, rot: [0.12, 0, 0] });
  b.box(0.26, 0.06, 0.08, 0, 0.66, 0.04, BLACK);
  b.geom(new TorusGeometry(FRONT_WHEEL_R + 0.06, 0.05, 6, 16, Math.PI * 0.85), RED, 0, FRONT_WHEEL_R, 0, {
    rot: [0, Math.PI / 2, 0.25],
  });
  return b.build();
}

function buildHandlebar() {
  const b = new GeoBuilder();
  b.cyl(0.02, 0.02, 0.74, 0, 0, 0, BLACK, { rot: [0, 0, Math.PI / 2], segments: 6 });
  for (const sx of [-1, 1]) b.cyl(0.032, 0.032, 0.14, sx * 0.34, 0, 0, "#3a3a3a", { rot: [0, 0, Math.PI / 2], segments: 8 });
  b.cyl(0.03, 0.03, 0.26, 0, -0.13, 0.02, BLACK, { segments: 6 });
  return b.build();
}

function buildLights() {
  const b = new GeoBuilder();
  b.cyl(0.115, 0.115, 0.02, 0, 1.0, -1.495, "#fff6cf", { rot: [Math.PI / 2, 0, 0], segments: 16 });
  for (const sx of [-1, 1]) {
    // Front indicators on the cowl shoulders
    b.box(0.09, 0.05, 0.06, sx * 0.3, 1.32, -1.24, "#ff9a1a");
    // Rear: vertical tail lamps + amber indicators on the rear panel
    b.box(0.1, 0.22, 0.03, sx * 0.58, 0.82, 1.44, "#ff2a1a");
    b.box(0.1, 0.07, 0.031, sx * 0.58, 1.0, 1.435, "#ff9a1a");
    // Reflectors on mud flaps
    b.cyl(0.035, 0.035, 0.01, sx * REAR_WHEEL_X, 0.3, 1.252, "#ff2a1a", { rot: [Math.PI / 2, 0, 0], segments: 8 });
  }
  // Decorative LED strip along the roof rail (very Egyptian)
  for (let i = 0; i < 9; i++) b.box(0.05, 0.03, 0.01, -0.6 + i * 0.15, 1.745, 1.39, i % 2 ? "#38e0ff" : "#ff4fd8");
  return b.build();
}

/** Blue evil-eye charm ("خرزة زرقا") hanging from the roof. */
function buildCharm() {
  const b = new GeoBuilder();
  b.cyl(0.006, 0.006, 0.24, 0, -0.12, 0, "#ddd", { segments: 3 });
  b.sphere(0.065, 0, -0.27, 0, "#1f63d6", { w: 10, h: 8 });
  b.sphere(0.035, 0, -0.27, 0.045, "#ffffff", { w: 8, h: 6 });
  b.sphere(0.018, 0, -0.27, 0.07, "#0b1630", { w: 6, h: 4 });
  return b.build();
}

interface TukTukProps {
  shadows: boolean;
  /** Pose to render; read every frame (mutable object, not React state). */
  pose: TukTukPose;
  /** Index into TUKTUK_PAINTS. */
  paint?: number;
  /** Animate small details (charm, fringe sway). Off for other racers. */
  detailed?: boolean;
}

export default function TukTuk({ shadows, pose, paint = 0, detailed = true }: TukTukProps) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const flame = useRef<Group>(null);
  const fork = useRef<Group>(null);
  const handle = useRef<Group>(null);
  const frontWheel = useRef<Mesh>(null);
  const rearL = useRef<Mesh>(null);
  const rearR = useRef<Mesh>(null);
  const fringe = useRef<Mesh>(null);
  const charm = useRef<Group>(null);
  const seated = useRef<(Mesh | null)[]>([]);
  const motion = useRef({ px: pose.x, pz: pose.z, vel: 0, roll: 0, yaw: 0, steer: 0, wheelRot: 0, charmA: 0, charmV: 0, t: 0 });
  const scheme = TUKTUK_PAINTS[paint % TUKTUK_PAINTS.length];

  const geo = useMemo(
    () => ({
      body: buildBody(scheme.main, scheme.dark),
      glass: buildGlass(),
      fringe: buildFringe(),
      rearWheel: buildWheel(REAR_WHEEL_R, 0.17),
      frontWheel: buildWheel(FRONT_WHEEL_R, 0.15),
      fork: buildFrontFork(scheme.main),
      handlebar: buildHandlebar(),
      lights: buildLights(),
      charm: buildCharm(),
      seated: PASSENGERS.map((p) => buildSeatedPassenger(p)),
    }),
    [scheme],
  );

  const mats = useMemo(() => {
    const rearTex: Texture = createTukTukRearTexture(scheme.main);
    const sideTex: Texture = createTukTukSideTexture(scheme.main);
    return {
      body: new MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.18 }),
      glass: new MeshStandardMaterial({ color: "#a9d4ee", transparent: true, opacity: 0.42, roughness: 0.04, metalness: 0.5, side: DoubleSide, depthWrite: false }),
      lights: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      rear: new MeshStandardMaterial({ map: rearTex, roughness: 0.45 }),
      side: new MeshStandardMaterial({ map: sideTex, roughness: 0.45 }),
      blob: new MeshBasicMaterial({ map: getSoftDotTexture(), color: "#000000", transparent: true, opacity: 0.55, depthWrite: false }),
      rearTex,
      sideTex,
    };
  }, [scheme]);

  useEffect(() => {
    return () => {
      const { seated: seatedGeos, ...rest } = geo;
      Object.values(rest).forEach((g) => g.dispose());
      seatedGeos.forEach((g) => g.dispose());
      mats.body.dispose();
      mats.glass.dispose();
      mats.lights.dispose();
      mats.rear.dispose();
      mats.side.dispose();
      mats.blob.dispose();
      mats.rearTex.dispose();
      mats.sideTex.dispose();
    };
  }, [geo, mats]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const m = motion.current;
    const r = root.current;
    const bd = body.current;
    if (!r || !bd) return;
    const h = pose.heading;
    const fx = -Math.sin(h);
    const fz = -Math.cos(h);
    // Lateral velocity in the vehicle's own frame (right = (cos h, -sin h)).
    const dx = pose.x - m.px;
    const dz = pose.z - m.pz;
    m.px = pose.x;
    m.pz = pose.z;
    const instVel = dt > 0 ? (dx * Math.cos(h) - dz * Math.sin(h)) / dt : 0;
    m.vel += (Math.max(-30, Math.min(30, instVel)) - m.vel) * Math.min(1, dt * 12);
    m.t += dt;

    const speed = pose.speed;
    m.wheelRot -= (speed * dt) / REAR_WHEEL_R;
    if (rearL.current) rearL.current.rotation.x = m.wheelRot;
    if (rearR.current) rearR.current.rotation.x = m.wheelRot;
    if (frontWheel.current) frontWheel.current.rotation.x = (m.wheelRot * REAR_WHEEL_R) / FRONT_WHEEL_R;
    seated.current.forEach((mesh, i) => {
      if (mesh) mesh.visible = pose.passenger === i;
    });
    // Invulnerability flicker after a race spin-out.
    r.visible = pose.ghost <= 0 || Math.floor(m.t * 14) % 2 === 0;

    if (pose.crashT >= 0) {
      // Tip onto its side and skid forward.
      const t = pose.crashT;
      const e = 1 - Math.exp(-t * 6);
      const side = Math.sign(m.vel || 1);
      bd.rotation.z = e * 1.15 * side;
      bd.rotation.x = Math.sin(Math.min(t, 0.6) * 10) * 0.12 * (1 - e);
      bd.position.y = Math.max(0, Math.sin(Math.min(t * 5, Math.PI)) * 0.45);
      r.rotation.y = h + e * 1.4 * side + m.yaw;
      r.position.set(pose.x + fx * e * 2.2, 0, pose.z + fz * e * 2.2);
      return;
    }
    r.position.set(pose.x, 0, pose.z);
    // Nitro: flickering exhaust flame.
    if (flame.current) {
      const on = pose.boost > 0.05;
      flame.current.visible = on;
      if (on) {
        const f = pose.boost * (0.75 + Math.sin(m.t * 47) * 0.15 + Math.sin(m.t * 31) * 0.1);
        flame.current.scale.set(0.8 + f * 0.3, 0.8 + f * 0.3, f);
      }
    }

    const lean = Math.max(-1, Math.min(1, m.vel / PLAYER.maxLateralSpeed));
    m.roll += (-lean * 0.16 - m.roll) * Math.min(1, dt * 8);
    m.yaw += (-lean * 0.22 - m.yaw) * Math.min(1, dt * 10);
    m.steer += (-lean * 0.55 - m.steer) * Math.min(1, dt * 14);
    let spin = 0;
    let hop = 0;
    if (pose.spinT >= 0 && pose.spinT < 0.8) {
      // Race spin-out: one full turn with a little hop, easing out.
      const k = pose.spinT / 0.8;
      spin = (1 - (1 - k) * (1 - k)) * Math.PI * 2;
      hop = Math.sin(k * Math.PI) * 0.35;
    }
    r.rotation.y = h + m.yaw + spin;
    bd.rotation.z = m.roll;
    // Suspension bounce + road vibration.
    const sp = Math.min(1, speed / 45);
    bd.position.y = Math.sin(m.t * 17) * 0.012 * (0.4 + sp) + Math.max(0, Math.sin(m.t * 3.1) * Math.sin(m.t * 7.3)) * 0.035 * sp + hop;
    bd.rotation.x = Math.sin(m.t * 9) * 0.006 + pose.boost * -0.03 - sp * 0.02;
    if (fork.current) fork.current.rotation.y = m.steer;
    if (handle.current) handle.current.rotation.y = m.steer * 0.8;
    if (!detailed) return;
    if (fringe.current) fringe.current.rotation.x = Math.sin(m.t * 11) * 0.01;
    // Pendulum charm swings with steering and bumps.
    const accel = -lean * 6 + Math.sin(m.t * 17) * 0.8;
    m.charmV += (accel - m.charmA * 30 - m.charmV * 3) * dt;
    m.charmA += m.charmV * dt;
    if (charm.current) {
      charm.current.rotation.z = m.charmA;
      charm.current.rotation.x = Math.sin(m.t * 5) * 0.08;
    }
  });

  return (
    <group ref={root} position={[pose.x, 0, pose.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0.1]} material={mats.blob} renderOrder={1}>
        <planeGeometry args={[2.0, 3.4]} />
      </mesh>
      <group ref={flame} position={[-0.42, 0.32, 1.62]} visible={false}>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.55]}>
          <coneGeometry args={[0.2, 1.1, 10, 1, true]} />
          <meshBasicMaterial color="#ff5a00" transparent opacity={0.85} depthWrite={false} blending={AdditiveBlending} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.28]}>
          <coneGeometry args={[0.08, 0.55, 8, 1, true]} />
          <meshBasicMaterial color="#ffd23f" transparent opacity={0.9} depthWrite={false} blending={AdditiveBlending} />
        </mesh>
      </group>
      <group ref={body}>
        <mesh geometry={geo.body} material={mats.body} castShadow={shadows} />
        <mesh geometry={geo.lights} material={mats.lights} />
        <mesh ref={fringe} geometry={geo.fringe} material={mats.body} />
        <mesh geometry={geo.glass} material={mats.glass} renderOrder={2} />
        {geo.seated.map((g, i) => (
          <mesh
            key={i}
            ref={(el) => {
              seated.current[i] = el;
            }}
            geometry={g}
            material={mats.body}
            visible={false}
          />
        ))}
        {/* Rear bumper sticker + plate */}
        <mesh position={[0, 0.78, 1.443]} rotation={[-0.035, 0, 0]} material={mats.rear}>
          <planeGeometry args={[1.0, 0.5]} />
        </mesh>
        {/* Side decals */}
        <mesh position={[0.689, 0.79, 0.08]} rotation={[0, Math.PI / 2, 0]} material={mats.side}>
          <planeGeometry args={[0.76, 0.19]} />
        </mesh>
        <mesh position={[-0.689, 0.79, 0.08]} rotation={[0, -Math.PI / 2, 0]} material={mats.side}>
          <planeGeometry args={[0.76, 0.19]} />
        </mesh>
        <group ref={handle} position={[0, 1.3, -0.76]}>
          <mesh geometry={geo.handlebar} material={mats.body} />
        </group>
        <group ref={charm} position={[0.3, 1.97, -0.9]}>
          <mesh geometry={geo.charm} material={mats.body} />
        </group>
      </group>
      <group ref={fork} position={[0, 0, FRONT_WHEEL_Z]}>
        <mesh geometry={geo.fork} material={mats.body} castShadow={shadows} />
        <mesh ref={frontWheel} position={[0, FRONT_WHEEL_R, 0]} geometry={geo.frontWheel} material={mats.body} castShadow={shadows} />
      </group>
      <mesh ref={rearL} position={[-REAR_WHEEL_X, REAR_WHEEL_R, REAR_WHEEL_Z]} geometry={geo.rearWheel} material={mats.body} castShadow={shadows} />
      <mesh ref={rearR} position={[REAR_WHEEL_X, REAR_WHEEL_R, REAR_WHEEL_Z]} geometry={geo.rearWheel} material={mats.body} castShadow={shadows} />
    </group>
  );
}
