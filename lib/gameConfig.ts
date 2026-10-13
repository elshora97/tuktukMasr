// Centralized gameplay configuration. World units are meters; the player
// drives toward -Z and stays near z = 0 while the world scrolls past.

export const LANES = {
  count: 4,
  width: 3.4,
} as const;

export const ROAD = {
  width: LANES.count * LANES.width, // 13.6
  shoulder: 1.0,
  /** Height of the bridge deck above the city below. */
  deckHeight: 16,
} as const;

/**
 * Cross-section of the bridge (x axis), right to left:
 * right barrier | 4 lanes (player side) | median w/ streetlights | 3 oncoming lanes | left barrier
 */
export const LAYOUT = (() => {
  const half = ROAD.width / 2;
  const rightBarrierX = half + ROAD.shoulder; // inner face
  const medianWidth = 1.2;
  const medianCenterX = -(half + ROAD.shoulder + medianWidth / 2);
  const oppLanes = 3;
  const oppRoadRight = medianCenterX - medianWidth / 2; // edge of the oncoming road (incl. shoulder)
  const oppLaneEdge = oppRoadRight - ROAD.shoulder;
  const oppRoadWidth = oppLanes * LANES.width + ROAD.shoulder * 2;
  const oppRoadCenterX = oppRoadRight - oppRoadWidth / 2;
  const leftBarrierX = oppRoadRight - oppRoadWidth; // inner face
  return {
    rightBarrierX,
    medianWidth,
    medianCenterX,
    oppLanes,
    oppLaneEdge,
    oppRoadWidth,
    oppRoadCenterX,
    leftBarrierX,
  };
})();

export function oppLaneCenter(i: number): number {
  return LAYOUT.oppLaneEdge - LANES.width * (i + 0.5);
}

/** Lateral x of the center of lane i (0 = leftmost). */
export function laneCenter(i: number): number {
  return -ROAD.width / 2 + LANES.width * (i + 0.5);
}

export const PLAYER = {
  halfWidth: 0.68,
  halfLength: 1.35,
  /** Collision box is shrunk so that "visual proximity" alone never kills. */
  hitShrinkX: 0.12,
  hitShrinkZ: 0.15,
  /** Max lateral speed in m/s when following the steering target. */
  maxLateralSpeed: 17,
  /** Exponential follow factor toward target x (higher = snappier). */
  followSharpness: 10,
  keyboardSteerSpeed: 15,
  /** Lateral travel limit (keeps the tuk-tuk on the asphalt). */
  xLimit: ROAD.width / 2 - 0.75,
} as const;

export const SPEED = {
  start: 22,
  max: 50,
  /** Meters of distance until max difficulty is reached. */
  rampDistance: 4200,
  menuCruise: 9,
} as const;

export const TRAFFIC = {
  spawnZ: -175,
  despawnZ: 18,
  /** Seconds between spawns at difficulty 0 and 1. */
  spawnIntervalStart: 1.05,
  spawnIntervalEnd: 0.42,
  /** Traffic absolute speed as a fraction of the *start* player speed. */
  speedFracMin: 0.28,
  speedFracMax: 0.62,
  /** Minimum bumper-to-bumper gap in the same lane. */
  minLaneGap: 7,
  /** Extra free length (beyond the tuk-tuk) a lane gap must provide to count as an escape. */
  escapeGap: 3.2,
  /** How many seconds ahead the fairness check simulates. */
  lookaheadSeconds: 7,
  lookaheadStep: 0.12,
  poolPerType: 8,
} as const;

export const SCORE = {
  overtake: 10,
  closeCallBonus: 15,
} as const;

/**
 * Floating shout-outs. Ordinary overtakes only score; a label appears just
 * for genuinely close passes, anchored to the car that was passed.
 */
export const LABELS = {
  /**
   * Max side-to-side gap (meters, body edge to body edge) during the pass for
   * it to count as a close overtake. Lane-center to lane-center passes leave
   * ~1.8 m, so 0.6 m means the player squeezed right next to the car.
   */
  closeOvertakeGap: 0.6,
  /** Minimum time between two labels. */
  cooldownMs: 1400,
  maxVisible: 2,
  /** Hard cap on a label's life. */
  lifetimeMs: 1500,
  /**
   * The label rides on the passed car but never slides further back than
   * this z (just beside the tuk-tuk's rear), so it stays readable for a moment
   * instead of vanishing with the car — and never covers the road ahead.
   */
  anchorMaxZ: 1.2,
  /** Car z at which it has left the chase camera's view. */
  carExitZ: 6,
  /** Time the label lingers (fading) after its car left the view. 0 = remove at once. */
  lingerAfterExitMs: 550,
} as const;

/** Egyptian colloquial overtake messages. */
export const OVERTAKE_MESSAGES = [
  "عدّيتك يا باشا! 😎",
  "وسّع يا معلم! 😂",
  "الله عليك!",
  "معدّي يا نجم!",
  "جامد يا سوّاق! 🔥",
  "يا عم بالراحة!",
  "سلام يا كابتن 👋",
  "التوكتوك ميتغلبش!",
  "فوت يا حبيبي!",
  "إيه الحلاوة دي!",
  "على جنب يا أسطى!",
  "أسطى الأسطوات! 💪",
] as const;

export const CLOSE_CALL_MESSAGES = [
  "يا ساتر يا رب! 😱",
  "كانت هتلبس! 😅",
  "على الشعرة! ✂️",
  "قلبي وقع! 💥",
  "فلتة يا ريس!",
] as const;

export const GAME_OVER_MESSAGES = [
  "خبطت يا أسطى! 💥",
  "الله يسامحك يا عم!",
  "ركنت في الكوبري! 🛑",
  "التوكتوك اتبهدل! 😵",
] as const;

export type VehicleType = "taxi" | "sedan" | "microbus" | "suv" | "pickup";

export interface VehicleSpec {
  type: VehicleType;
  /** Roof height in meters (label anchor). */
  height: number;
  halfWidth: number;
  halfLength: number;
  /** Relative spawn weight. */
  weight: number;
  /** Palette of body colors. */
  colors: readonly string[];
  /** Fraction applied to traffic speed (microbuses rush, pickups crawl). */
  speedBias: number;
}

export const VEHICLES: Record<VehicleType, VehicleSpec> = {
  taxi: {
    type: "taxi",
    height: 1.75,
    halfWidth: 0.88,
    halfLength: 2.15,
    weight: 3,
    colors: ["#f4f4f0"],
    speedBias: 1.05,
  },
  sedan: {
    type: "sedan",
    height: 1.45,
    halfWidth: 0.9,
    halfLength: 2.2,
    weight: 3,
    colors: ["#b8bcc2", "#20242c", "#7a1d24", "#2b4a7a", "#d8d2c4", "#4e5a48", "#9a9fa6"],
    speedBias: 1,
  },
  microbus: {
    type: "microbus",
    height: 2.15,
    halfWidth: 1.0,
    halfLength: 2.55,
    weight: 2,
    colors: ["#f2f2ee", "#ecebe4"],
    speedBias: 1.15,
  },
  suv: {
    type: "suv",
    height: 1.95,
    halfWidth: 1.0,
    halfLength: 2.4,
    weight: 1.4,
    colors: ["#111317", "#e9e9e6", "#5c6066", "#2d3a2a", "#6b2a1e"],
    speedBias: 1.05,
  },
  pickup: {
    type: "pickup",
    height: 1.95,
    halfWidth: 0.86,
    halfLength: 2.1,
    weight: 1.2,
    colors: ["#1f5aa8", "#d9d6cc", "#a8261f"],
    speedBias: 0.8,
  },
};

export const VEHICLE_TYPES = Object.keys(VEHICLES) as VehicleType[];

export const STORAGE_KEYS = {
  best: "toktok-kobry:best",
  sound: "toktok-kobry:sound",
  quality: "toktok-kobry:quality",
  pads: "toktok-kobry:pads",
} as const;

/** Difficulty 0..1 from distance traveled. */
export function difficultyFor(distance: number): number {
  const t = Math.min(1, Math.max(0, distance / SPEED.rampDistance));
  // ease-out so the early game ramps faster than the late game
  return 1 - (1 - t) * (1 - t);
}

export function playerSpeedFor(distance: number): number {
  const d = difficultyFor(distance);
  return SPEED.start + (SPEED.max - SPEED.start) * d;
}
