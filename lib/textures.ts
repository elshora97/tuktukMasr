import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import { LANES } from "./gameConfig";
import { seeded } from "./geometryKit";

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  return { c, ctx };
}

function toTexture(c: HTMLCanvasElement, repeat = true) {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  if (repeat) {
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
  }
  t.anisotropy = 4;
  return t;
}

function cssVar(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function fontStack(kind: "body" | "display") {
  return kind === "display"
    ? `${cssVar("--font-lalezar", "Lalezar")}, ${cssVar("--font-cairo", "Cairo")}, sans-serif`
    : `${cssVar("--font-cairo", "Cairo")}, Tahoma, sans-serif`;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, rnd: () => number, n: number, colors: string[], size = 2) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    const s = 0.5 + rnd() * size;
    ctx.fillRect(rnd() * w, rnd() * h, s, s);
  }
}

/** Road tile length in meters (texture repeats along the road every tile). */
export const ROAD_TILE = 32;
/** Shoulder width painted into the road texture on each side. */
export const ROAD_TEX_SHOULDER = 1.0;

/**
 * Worn Cairo asphalt: patched surface, tire-darkened tracks, faded dashed
 * lane lines, sand drifting against the barriers.
 */
export function createRoadTexture(lanes: number = LANES.count, seed = 7) {
  const rnd = seeded(seed);
  const widthM = lanes * LANES.width + ROAD_TEX_SHOULDER * 2;
  const W = 512;
  const H = 1024;
  const pxm = W / widthM;
  const pym = H / ROAD_TILE;
  const { c, ctx } = makeCanvas(W, H);
  ctx.fillStyle = "#57534f";
  ctx.fillRect(0, 0, W, H);
  // Large repair patches of slightly different asphalt.
  for (let i = 0; i < 14; i++) {
    const pw = (1 + rnd() * 4) * pxm;
    const ph = (1 + rnd() * 6) * pym;
    const shade = 70 + Math.floor(rnd() * 24);
    ctx.fillStyle = `rgb(${shade},${shade - 3},${shade - 6})`;
    ctx.globalAlpha = 0.55 + rnd() * 0.35;
    ctx.fillRect(rnd() * W, rnd() * H, pw, ph);
  }
  ctx.globalAlpha = 1;
  speckle(ctx, W, H, rnd, 26000, ["#4a4744", "#625e59", "#3f3c3a", "#6d6862", "#514d49"], 2.2);
  // Tire tracks (two darker bands per lane).
  for (let l = 0; l < lanes; l++) {
    const cx = (ROAD_TEX_SHOULDER + LANES.width * (l + 0.5)) * pxm;
    for (const off of [-0.8, 0.8]) {
      const g = ctx.createLinearGradient(cx + off * pxm - 14, 0, cx + off * pxm + 14, 0);
      g.addColorStop(0, "rgba(30,28,27,0)");
      g.addColorStop(0.5, "rgba(30,28,27,0.28)");
      g.addColorStop(1, "rgba(30,28,27,0)");
      ctx.fillStyle = g;
      ctx.fillRect(cx + off * pxm - 14, 0, 28, H);
    }
  }
  // Oil stains in the middle of lanes.
  for (let i = 0; i < 10; i++) {
    const l = Math.floor(rnd() * lanes);
    const cx = (ROAD_TEX_SHOULDER + LANES.width * (l + 0.5)) * pxm;
    ctx.fillStyle = "rgba(25,22,20,0.25)";
    ctx.beginPath();
    ctx.ellipse(cx + (rnd() - 0.5) * 20, rnd() * H, 6 + rnd() * 10, 10 + rnd() * 24, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Cracks
  ctx.strokeStyle = "rgba(28,26,24,0.55)";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 26; i++) {
    let x = rnd() * W;
    let y = rnd() * H;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (rnd() - 0.5) * 22;
      y += (rnd() - 0.2) * 26;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Sandy shoulders (desert dust collects against the barriers).
  for (const side of [0, 1]) {
    const x0 = side === 0 ? 0 : W - ROAD_TEX_SHOULDER * pxm;
    const g = ctx.createLinearGradient(side === 0 ? 0 : W, 0, side === 0 ? ROAD_TEX_SHOULDER * pxm : W - ROAD_TEX_SHOULDER * pxm, 0);
    g.addColorStop(0, "rgba(176,150,112,0.85)");
    g.addColorStop(1, "rgba(150,128,98,0.15)");
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, ROAD_TEX_SHOULDER * pxm, H);
  }
  speckle(ctx, ROAD_TEX_SHOULDER * pxm, H, rnd, 2500, ["#a89070", "#8d7a60", "#c2a982"], 2.5);
  // Worn paint helper
  const paint = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.78;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    // erode
    for (let i = 0; i < (w * h) / 9; i++) {
      ctx.fillStyle = rnd() > 0.5 ? "#55514d" : "#4a4643";
      ctx.globalAlpha = 0.5 + rnd() * 0.5;
      const s = 1 + rnd() * 2.5;
      ctx.fillRect(x + rnd() * w - 1, y + rnd() * h - 1, s, s);
    }
    ctx.globalAlpha = 1;
  };
  // Edge lines (solid)
  const lw = 0.15 * pxm;
  paint(ROAD_TEX_SHOULDER * pxm - lw / 2, 0, lw, H, "#e9e3d2");
  paint(W - ROAD_TEX_SHOULDER * pxm - lw / 2, 0, lw, H, "#e8c64a");
  // Dashed lane lines: 3m dash, 5m gap
  for (let l = 1; l < lanes; l++) {
    const x = (ROAD_TEX_SHOULDER + LANES.width * l) * pxm - lw / 2;
    for (let z = 0; z < ROAD_TILE; z += 8) {
      paint(x, z * pym + 2, lw, 3 * pym, "#ece6d6");
    }
  }
  return toTexture(c);
}

export function roadTextureWidth(lanes: number = LANES.count) {
  return lanes * LANES.width + ROAD_TEX_SHOULDER * 2;
}

/** Weathered concrete with drip stains (barriers, median, gantry posts). */
export function createConcreteTexture(seed = 3, rotate = false) {
  const rnd = seeded(seed);
  const W = 256;
  const H = 128;
  const { c, ctx } = makeCanvas(W, H);
  ctx.fillStyle = "#b8ad9c";
  ctx.fillRect(0, 0, W, H);
  speckle(ctx, W, H, rnd, 5000, ["#a89e8e", "#c5bba9", "#9d9383", "#cfc6b5"], 2);
  // Drips
  for (let i = 0; i < 18; i++) {
    const x = rnd() * W;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(70,62,52,0.0)");
    g.addColorStop(0.3, "rgba(70,62,52,0.25)");
    g.addColorStop(1, "rgba(70,62,52,0.45)");
    ctx.fillStyle = g;
    ctx.fillRect(x, H * rnd() * 0.4, 2 + rnd() * 6, H);
  }
  // Dust at the bottom
  const g = ctx.createLinearGradient(0, H * 0.7, 0, H);
  g.addColorStop(0, "rgba(120,100,70,0)");
  g.addColorStop(1, "rgba(120,100,70,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Expansion joints
  ctx.fillStyle = "rgba(60,52,44,0.6)";
  ctx.fillRect(0, 0, 2, H);
  ctx.fillRect(W / 2, 0, 2, H);
  if (!rotate) return toTexture(c);
  // Rotate 90° clockwise so drips run along U (extrusion side walls map U to height).
  const r = makeCanvas(H, W);
  r.ctx.translate(H, 0);
  r.ctx.rotate(Math.PI / 2);
  r.ctx.drawImage(c, 0, 0);
  return toTexture(r.c);
}

/** Black/yellow painted curb stones. */
export function createCurbTexture() {
  const { c, ctx } = makeCanvas(128, 16);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? "#1d1c1a" : "#e9bf2a";
    ctx.fillRect(i * 32, 0, 32, 16);
  }
  ctx.fillStyle = "rgba(120,100,70,0.35)";
  ctx.fillRect(0, 10, 128, 6);
  return toTexture(c);
}

/** Facade tile: 4 window columns x 4 floors (14m x 12m). Tinted per instance. */
export const FACADE_TILE_W = 14;
export const FACADE_TILE_H = 12;

export function createFacadeTexture(seed = 11) {
  const rnd = seeded(seed);
  const W = 256;
  const H = 256;
  const { c, ctx } = makeCanvas(W, H);
  ctx.fillStyle = "#f2ebe0";
  ctx.fillRect(0, 0, W, H);
  speckle(ctx, W, H, rnd, 3000, ["#e4dccd", "#ece3d5", "#d8cfbf"], 2);
  // Grime streaks
  for (let i = 0; i < 20; i++) {
    ctx.fillStyle = "rgba(90,78,60,0.12)";
    ctx.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 4, 30 + rnd() * 60);
  }
  const cols = 4;
  const rows = 4;
  const cw = W / cols;
  const rh = H / rows;
  const shutters = ["#4f6b3c", "#6b4a2b", "#3e5a6b", "#7a6a4a"];
  const laundry = ["#d64545", "#3f7fd1", "#f1c232", "#ffffff", "#66a35a", "#e07ab0"];
  for (let r = 0; r < rows; r++) {
    // Floor slab line
    ctx.fillStyle = "rgba(120,104,84,0.35)";
    ctx.fillRect(0, r * rh + rh - 6, W, 4);
    for (let col = 0; col < cols; col++) {
      const x = col * cw + cw * 0.2;
      const y = r * rh + rh * 0.18;
      const w = cw * 0.6;
      const h = rh * 0.56;
      const kind = rnd();
      // Window recess
      ctx.fillStyle = "#2b2622";
      ctx.fillRect(x, y, w, h);
      if (kind < 0.45) {
        // Wooden shutters ("شيش") half open
        ctx.fillStyle = shutters[Math.floor(rnd() * shutters.length)];
        const open = rnd() * 0.5;
        ctx.fillRect(x, y, w * (0.5 - open / 2), h);
        ctx.fillRect(x + w * (0.5 + open / 2), y, w * (0.5 - open / 2), h);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        for (let s = 0; s < h; s += 4) ctx.fillRect(x, y + s, w, 1);
      } else {
        ctx.fillStyle = rnd() > 0.5 ? "#55697a" : "#3a4652";
        ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
      }
      if (rnd() < 0.5) {
        // Balcony slab + railing
        ctx.fillStyle = "#d9cfbf";
        ctx.fillRect(x - 6, y + h - 2, w + 12, 6);
        ctx.fillStyle = "rgba(40,36,32,0.8)";
        ctx.fillRect(x - 6, y + h * 0.55, w + 12, 2);
        for (let b = x - 6; b < x + w + 6; b += 4) ctx.fillRect(b, y + h * 0.55, 1, h * 0.45);
        // Laundry!
        if (rnd() < 0.45) {
          for (let k = 0; k < 4; k++) {
            ctx.fillStyle = laundry[Math.floor(rnd() * laundry.length)];
            ctx.fillRect(x + k * (w / 4) + 2, y + h * 0.58, w / 5, 6 + rnd() * 8);
          }
        }
      }
      if (rnd() < 0.3) {
        // Split AC unit
        ctx.fillStyle = "#f4f4f2";
        ctx.fillRect(x + w + 2, y + h * 0.2, 10, 8);
        ctx.fillStyle = "#999";
        ctx.fillRect(x + w + 3, y + h * 0.2 + 2, 8, 1);
      }
    }
  }
  return toTexture(c);
}

/** Exposed red-brick top floors with concrete frame — the unfinished Cairo roofline. */
export function createBrickTexture(seed = 5) {
  const rnd = seeded(seed);
  const W = 128;
  const H = 64;
  const { c, ctx } = makeCanvas(W, H);
  ctx.fillStyle = "#9a5a3c";
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 6) {
    const off = (y / 6) % 2 ? 6 : 0;
    for (let x = -off; x < W; x += 12) {
      const s = 130 + Math.floor(rnd() * 40);
      ctx.fillStyle = `rgb(${s},${Math.floor(s * 0.55)},${Math.floor(s * 0.38)})`;
      ctx.fillRect(x + 1, y + 1, 10, 4);
    }
  }
  // concrete columns and beam
  ctx.fillStyle = "#b3aa9a";
  ctx.fillRect(0, 0, 8, H);
  ctx.fillRect(W / 2 - 4, 0, 8, H);
  ctx.fillRect(0, H - 6, W, 6);
  return toTexture(c);
}

/** Generic text-panel drawer used for road signs and billboards. */
export interface SignSpec {
  bg: string;
  border?: string;
  title: string;
  titleColor?: string;
  sub?: string;
  subColor?: string;
  arrow?: "left" | "right" | "up";
  latin?: string;
  display?: boolean;
  w?: number;
  h?: number;
  stripe?: string;
}

export function createSignTexture(spec: SignSpec) {
  const W = spec.w ?? 512;
  const H = spec.h ?? 256;
  const { c, ctx } = makeCanvas(W, H);
  ctx.fillStyle = spec.bg;
  ctx.fillRect(0, 0, W, H);
  if (spec.stripe) {
    ctx.fillStyle = spec.stripe;
    ctx.fillRect(0, H - H * 0.14, W, H * 0.14);
  }
  if (spec.border) {
    ctx.strokeStyle = spec.border;
    ctx.lineWidth = Math.max(6, W * 0.014);
    const m = ctx.lineWidth * 1.4;
    ctx.beginPath();
    ctx.roundRect(m, m, W - m * 2, H - m * 2, 14);
    ctx.stroke();
  }
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const titleSize = Math.floor(H * (spec.sub || spec.latin ? 0.3 : 0.42));
  ctx.font = `700 ${titleSize}px ${fontStack(spec.display ? "display" : "body")}`;
  ctx.fillStyle = spec.titleColor ?? "#ffffff";
  const hasArrow = Boolean(spec.arrow);
  const textX = hasArrow ? W * 0.58 : W / 2;
  const titleY = spec.sub || spec.latin ? H * 0.38 : H * 0.52;
  fitText(ctx, spec.title, textX, titleY, hasArrow ? W * 0.7 : W * 0.86, titleSize);
  if (spec.sub) {
    const s = Math.floor(H * 0.17);
    ctx.font = `600 ${s}px ${fontStack("body")}`;
    ctx.fillStyle = spec.subColor ?? "#ffffff";
    fitText(ctx, spec.sub, textX, H * (spec.latin ? 0.64 : 0.7), hasArrow ? W * 0.7 : W * 0.86, s);
  }
  if (spec.latin) {
    ctx.direction = "ltr";
    const s = Math.floor(H * 0.13);
    ctx.font = `600 ${s}px Arial, sans-serif`;
    ctx.fillStyle = spec.subColor ?? "#ffffff";
    ctx.fillText(spec.latin, textX, H * 0.83);
  }
  if (spec.arrow) drawArrow(ctx, W * 0.14, H * 0.5, H * 0.32, spec.arrow, spec.titleColor ?? "#fff");
  return toTexture(c, false);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number) {
  const m = ctx.measureText(text).width;
  if (m > maxW) {
    const scaled = Math.floor((size * maxW) / m);
    ctx.font = ctx.font.replace(`${size}px`, `${scaled}px`);
  }
  ctx.fillText(text, x, y);
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, dir: "left" | "right" | "up", color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dir === "up" ? -Math.PI / 2 : dir === "left" ? Math.PI : 0);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-s, -s * 0.18);
  ctx.lineTo(s * 0.15, -s * 0.18);
  ctx.lineTo(s * 0.15, -s * 0.55);
  ctx.lineTo(s, 0);
  ctx.lineTo(s * 0.15, s * 0.55);
  ctx.lineTo(s * 0.15, s * 0.18);
  ctx.lineTo(-s, s * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Round speed-limit sign. */
export function createSpeedSignTexture(limit: string) {
  const S = 256;
  const { c, ctx } = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.48, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#d22a1f";
  ctx.lineWidth = S * 0.1;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#111";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${S * 0.36}px ${fontStack("body")}`;
  ctx.fillText(limit, S / 2, S / 2 + S * 0.02);
  return toTexture(c, false);
}

/**
 * Rear panel of the tuk-tuk: the classic Egyptian bumper sticker
 * "ما تبصليش بعين ردية" plus an Arabic license plate.
 */
export function createTukTukRearTexture(bg = "#b5141f") {
  const W = 512;
  const H = 256;
  const { c, ctx } = makeCanvas(W, H);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // yellow trim and decorative triangles
  ctx.fillStyle = "#f6c21c";
  ctx.fillRect(0, 0, W, 16);
  ctx.fillRect(0, H - 14, W, 14);
  for (let x = 0; x < W; x += 32) {
    ctx.fillStyle = (x / 32) % 2 ? "#18a39a" : "#f6c21c";
    ctx.beginPath();
    ctx.moveTo(x, 16);
    ctx.lineTo(x + 32, 16);
    ctx.lineTo(x + 16, 36);
    ctx.closePath();
    ctx.fill();
  }
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Sticker
  ctx.font = `400 58px ${fontStack("display")}`;
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#1a0d06";
  ctx.strokeText("ما تبصليش بعين ردية", W / 2, 88);
  ctx.fillStyle = "#ffe066";
  ctx.fillText("ما تبصليش بعين ردية", W / 2, 88);
  ctx.font = `700 26px ${fontStack("body")}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText("الصبر مفتاح الفرج ✦ يا رب سترك", W / 2, 138);
  // Plate
  const pw = 200;
  const ph = 72;
  const px = W / 2 - pw / 2;
  const py = 160;
  ctx.fillStyle = "#f4f4ee";
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 8);
  ctx.fill();
  ctx.fillStyle = "#e07a1f";
  ctx.fillRect(px, py, pw, 20);
  ctx.fillStyle = "#111";
  ctx.font = `700 15px ${fontStack("body")}`;
  ctx.fillText("مصر  •  توكتوك", W / 2, py + 11);
  ctx.font = `700 34px ${fontStack("body")}`;
  ctx.fillText("ط ك س  ٧٨٦", W / 2, py + 48);
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 8);
  ctx.stroke();
  return toTexture(c, false);
}

/** Side decal for the tuk-tuk cabin. */
export function createTukTukSideTexture(bg = "#b5141f") {
  const W = 512;
  const H = 128;
  const { c, ctx } = makeCanvas(W, H);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#f6c21c";
  ctx.fillRect(0, H * 0.72, W, 10);
  ctx.fillStyle = "#18a39a";
  ctx.fillRect(0, H * 0.72 + 12, W, 6);
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `400 52px ${fontStack("display")}`;
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#1a0d06";
  ctx.strokeText("ملك الكوبري", W / 2, H * 0.38);
  ctx.fillStyle = "#ffffff";
  ctx.fillText("ملك الكوبري", W / 2, H * 0.38);
  return toTexture(c, false);
}

/** Soft round sprite for dust and smoke particles. */
export function createSoftDotTexture() {
  const S = 64;
  const { c, ctx } = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c, false);
}


let softDot: ReturnType<typeof createSoftDotTexture> | null = null;
/** Shared soft dot (blob shadows, dust, smoke). Never disposed — tiny and reused. */
export function getSoftDotTexture() {
  if (!softDot) softDot = createSoftDotTexture();
  return softDot;
}

/** Beige concrete paving tiles for city sidewalks. */
export function createPavingTexture(seed = 21) {
  const rnd = seeded(seed);
  const S = 256;
  const { c, ctx } = makeCanvas(S, S);
  ctx.fillStyle = "#c9b99a";
  ctx.fillRect(0, 0, S, S);
  const n = 4;
  const t = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = 185 + Math.floor(rnd() * 30);
      ctx.fillStyle = `rgb(${v},${v - 12},${v - 34})`;
      ctx.fillRect(x * t + 2, y * t + 2, t - 4, t - 4);
    }
  }
  speckle(ctx, S, S, rnd, 2500, ["#a8987c", "#b9aa8c", "#d6c8aa"], 2);
  // a few stains and cracked tiles
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = "rgba(80,66,48,0.18)";
    ctx.beginPath();
    ctx.ellipse(rnd() * S, rnd() * S, 6 + rnd() * 14, 4 + rnd() * 10, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c);
}
