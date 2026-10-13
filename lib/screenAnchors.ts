import { Vector3, type Camera } from "three";

/**
 * DOM elements pinned to moving 3D targets (overtake labels on cars, player
 * name tags). The render loop projects each target every frame and writes the
 * element's transform directly — no React renders per frame.
 */
interface Anchor {
  el: HTMLElement | null;
  /** Writes the target's world position into `out`; false = target gone. */
  resolve: ((out: Vector3) => boolean) | null;
  /** Called once when the target disappears or leaves the viewport. */
  onLost?: () => void;
  /** Hide (instead of dropping) when off-screen — used for name tags. */
  persistent?: boolean;
}

const anchors = new Map<string, Anchor>();
const tmp = new Vector3();

function entry(id: string): Anchor {
  let a = anchors.get(id);
  if (!a) {
    a = { el: null, resolve: null };
    anchors.set(id, a);
  }
  return a;
}

export function setAnchorTarget(
  id: string,
  resolve: (out: Vector3) => boolean,
  opts: { onLost?: () => void; persistent?: boolean } = {},
) {
  const a = entry(id);
  a.resolve = resolve;
  a.onLost = opts.onLost;
  a.persistent = opts.persistent;
}

/** Ref callback target: registers (or unregisters with null) the DOM element. */
export function bindAnchorElement(id: string, el: HTMLElement | null) {
  const a = entry(id);
  a.el = el;
  if (el) el.style.visibility = "hidden"; // until first projection
  if (!el && !a.resolve) anchors.delete(id);
}

export function removeAnchor(id: string) {
  anchors.delete(id);
}

export function clearAnchors(prefix: string) {
  for (const id of anchors.keys()) if (id.startsWith(prefix)) anchors.delete(id);
}

/** Called once per frame from inside the canvas. */
export function updateAnchors(camera: Camera, width: number, height: number) {
  for (const [id, a] of anchors) {
    if (!a.resolve || !a.el) continue;
    const alive = a.resolve(tmp);
    let onScreen = false;
    if (alive) {
      tmp.project(camera);
      onScreen = tmp.z < 1 && Math.abs(tmp.x) < 1.02 && Math.abs(tmp.y) < 1.02;
    }
    if (!onScreen) {
      if (a.persistent && alive) {
        a.el.style.visibility = "hidden";
        continue;
      }
      a.el.style.visibility = "hidden";
      anchors.delete(id);
      a.onLost?.();
      continue;
    }
    const px = ((tmp.x + 1) / 2) * width;
    const py = ((1 - tmp.y) / 2) * height;
    a.el.style.visibility = "visible";
    a.el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -100%)`;
  }
}
