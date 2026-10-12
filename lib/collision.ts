import { LANES, PLAYER, TRAFFIC } from "./gameConfig";

export interface Box2 {
  x: number;
  z: number;
  halfW: number;
  halfL: number;
}

/** Axis-aligned overlap test on the road plane (x = lateral, z = forward). */
export function aabbOverlap(a: Box2, b: Box2): boolean {
  return Math.abs(a.x - b.x) < a.halfW + b.halfW && Math.abs(a.z - b.z) < a.halfL + b.halfL;
}

/** Player hit box, slightly smaller than the visible body for fairness. */
export function playerHitBox(x: number, out: Box2): Box2 {
  out.x = x;
  out.z = 0;
  out.halfW = PLAYER.halfWidth - PLAYER.hitShrinkX;
  out.halfL = PLAYER.halfLength - PLAYER.hitShrinkZ;
  return out;
}

/** Shrink factor applied to traffic hit boxes (rounded corners, mirrors, etc.). */
export const TRAFFIC_HIT_SCALE_X = 0.9;
export const TRAFFIC_HIT_SCALE_Z = 0.94;

export interface LaneOccupant {
  lane: number;
  z: number;
  halfL: number;
  /** Absolute forward speed. Relative speed toward the player is playerSpeed - speed. */
  speed: number;
}

/**
 * Fairness check run once per spawn: simulates the candidate together with
 * every active car and rejects the spawn if, at any moment before the
 * candidate reaches the player, every other lane is blocked close to it
 * (i.e. it would complete a "wall" across the bridge).
 *
 * Gaps between cars only depend on their speed difference, so the player
 * speed only determines the time window we need to simulate.
 */
export function isSpawnFair(
  candidate: LaneOccupant,
  others: readonly LaneOccupant[],
  playerSpeed: number,
): boolean {
  const relC = Math.max(0.5, playerSpeed - candidate.speed);
  const tMax = Math.min(TRAFFIC.lookaheadSeconds * 3, (Math.abs(candidate.z) + 10) / relC);
  const freeLen = PLAYER.halfLength * 2 + TRAFFIC.escapeGap;
  const blocked = new Array<boolean>(LANES.count);

  for (let t = 0; t <= tMax; t += TRAFFIC.lookaheadStep) {
    const zc = candidate.z + relC * t;
    if (zc > 6) break; // already passed the player
    blocked.fill(false);
    blocked[candidate.lane] = true;
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (o.lane === candidate.lane || blocked[o.lane]) continue;
      const zo = o.z + (playerSpeed - o.speed) * t;
      // Lane is blocked if the free stretch next to the candidate is too short.
      if (Math.abs(zo - zc) < candidate.halfL + o.halfL + freeLen) blocked[o.lane] = true;
    }
    let all = true;
    for (let l = 0; l < LANES.count; l++) {
      if (!blocked[l]) {
        all = false;
        break;
      }
    }
    if (all) return false;
  }
  return true;
}
