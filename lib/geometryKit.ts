import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const tmpColor = new Color();
const tmpMat = new Matrix4();
const tmpQuat = new Quaternion();
const tmpEuler = new Euler();
const tmpPos = new Vector3();
const tmpScale = new Vector3(1, 1, 1);

export interface PartOpts {
  /** Rotation in radians [x, y, z]. */
  rot?: [number, number, number];
  /** Scale top face width (x) — for cabins, nose cones, etc. */
  taperX?: number;
  /** Scale top face depth (z). */
  taperZ?: number;
  /** Shift top face along z (positive = toward the rear). */
  shiftZ?: number;
}

/**
 * Accumulates simple primitives with baked vertex colors, then merges them
 * into a single BufferGeometry (= one draw call per material).
 */
export class GeoBuilder {
  private parts: BufferGeometry[] = [];

  private push(g: BufferGeometry, color: string | Color, x: number, y: number, z: number, opts?: PartOpts) {
    if (opts && (opts.taperX !== undefined || opts.taperZ !== undefined || opts.shiftZ !== undefined)) {
      const pos = g.getAttribute("position");
      const tx = opts.taperX ?? 1;
      const tz = opts.taperZ ?? 1;
      const sz = opts.shiftZ ?? 0;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) > 0) {
          pos.setX(i, pos.getX(i) * tx);
          pos.setZ(i, pos.getZ(i) * tz + sz);
        }
      }
      g.computeVertexNormals();
    }
    tmpEuler.set(opts?.rot?.[0] ?? 0, opts?.rot?.[1] ?? 0, opts?.rot?.[2] ?? 0);
    tmpQuat.setFromEuler(tmpEuler);
    tmpPos.set(x, y, z);
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    g.applyMatrix4(tmpMat);
    if (typeof color === "string") tmpColor.set(color);
    else tmpColor.copy(color);
    const count = g.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }
    g.setAttribute("color", new Float32BufferAttribute(colors, 3));
    // Normalize attribute sets so every part can be merged.
    if (!g.getAttribute("uv")) {
      g.setAttribute("uv", new Float32BufferAttribute(new Float32Array(count * 2), 2));
    }
    if (!g.index) {
      const idx: number[] = [];
      for (let i = 0; i < count; i++) idx.push(i);
      g.setIndex(idx);
    }
    this.parts.push(g);
    return this;
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, color: string | Color, opts?: PartOpts) {
    return this.push(new BoxGeometry(w, h, d), color, x, y, z, opts);
  }

  cyl(
    rTop: number,
    rBottom: number,
    h: number,
    x: number,
    y: number,
    z: number,
    color: string | Color,
    opts?: PartOpts & { segments?: number },
  ) {
    return this.push(new CylinderGeometry(rTop, rBottom, h, opts?.segments ?? 10), color, x, y, z, opts);
  }

  /** Wheel lying on the x axis. */
  wheel(r: number, w: number, x: number, y: number, z: number, tire = "#16171a", hub = "#9a9ea6") {
    this.cyl(r, r, w, x, y, z, tire, { rot: [0, 0, Math.PI / 2], segments: 12 });
    this.cyl(r * 0.55, r * 0.55, w + 0.02, x, y, z, hub, { rot: [0, 0, Math.PI / 2], segments: 8 });
    return this;
  }

  sphere(r: number, x: number, y: number, z: number, color: string | Color, opts?: PartOpts & { w?: number; h?: number }) {
    return this.push(new SphereGeometry(r, opts?.w ?? 8, opts?.h ?? 6), color, x, y, z, opts);
  }

  /** Add any prebuilt geometry (e.g. an extruded body panel). Takes ownership. */
  geom(g: BufferGeometry, color: string | Color, x = 0, y = 0, z = 0, opts?: PartOpts) {
    return this.push(g, color, x, y, z, opts);
  }

  get empty() {
    return this.parts.length === 0;
  }

  build(): BufferGeometry {
    if (this.parts.length === 0) return new BufferGeometry();
    const merged = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

export { seeded } from "./prng";

/**
 * Extrude a side-profile Shape (drawn in the z/y plane: shape X = world z,
 * shape Y = world y) across the vehicle width, centered on x = 0, with
 * rounded bevels and smooth normals. `taper` optionally scales x by world z
 * (e.g. a nose that narrows toward the front).
 */
export function extrudeProfile(
  shape: Shape,
  width: number,
  opts: { bevel?: number; segments?: number; taper?: (z: number) => number } = {},
): BufferGeometry {
  const bevel = opts.bevel ?? 0.03;
  const depth = Math.max(0.001, width - bevel * 2);
  const g = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: opts.segments ?? 14,
  });
  // shape (X, Y, Zextrude) -> world (x = Zextrude - depth/2, y = Y, z = X)
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const sx = pos.getX(i);
    const sy = pos.getY(i);
    const sz = pos.getZ(i) - depth / 2;
    const k = opts.taper ? opts.taper(sx) : 1;
    pos.setXYZ(i, sz * k, sy, sx);
  }
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  const merged = mergeVertices(g, 1e-4);
  g.dispose();
  // The z/x swap mirrors the winding; flip triangles back so faces point outward.
  const idx = merged.index!;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  merged.computeVertexNormals();
  return merged;
}
