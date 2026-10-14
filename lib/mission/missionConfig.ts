/** Tunables and content for the passenger-pickup mode ("وصلني يا معلم"). */
import { NODE_BY_ID, type LandmarkKind } from "./cairoMap";

export const STREET = {
  lanes: 3,
  laneWidth: 3.4,
  /** Painted shoulder on each side inside the curbs. */
  shoulder: 1.0,
  sidewalk: 3.4,
  curbHeight: 0.16,
} as const;

/** Half width of the asphalt (lanes + shoulders). */
export const ROAD_HALF = (STREET.lanes * STREET.laneWidth) / 2 + STREET.shoulder;

/** Lateral center of lane i measured from the road centerline (+ = right). */
export function streetLane(i: number): number {
  return (i - (STREET.lanes - 1) / 2) * STREET.laneWidth;
}

export const MISSION = {
  /** City cruising speed (m/s ≈ 54 km/h) and acceleration back up to it. */
  cruiseSpeed: 15,
  accel: 5.5,
  /** Holding the brake stops from cruise in about one second. */
  brakeDecel: 16,
  /** Below this speed the tuk-tuk counts as stopped. */
  stoppedSpeed: 1.2,
  /** Lateral steering authority fades when nearly stopped (no sideways sliding). */
  minSteerFactor: 0.2,

  /** Passenger stands this far into the route (visible from the start). */
  passengerS: 190,
  /** Pickup zone along the road, relative to the passenger. */
  pickupBefore: 14,
  pickupAfter: 5,
  /** Driving this far past the passenger without stopping misses them. */
  missAfter: 9,
  /** Seconds the tuk-tuk must stay stopped inside the zone. */
  holdS: 0.9,
  boardingS: 1.5,
  dialogueS: 3.2,
  /** Drop-off zone length centered on the destination point. */
  dropHalf: 12,
  arrivingS: 1.6,

  /** Street corners are rounded with at most this radius. */
  turnRadius: 26,

  /** Endless shift: lives, chance of a two-passenger fare, pause between fares. */
  lives: 3,
  groupChance: 0.35,
  groupScoreMul: 1.6,
  nextFareS: 2.8,
  crashRecoverS: 2.6,

  /** Traffic. */
  trafficMax: 9,
  trafficSpeedMin: 6.5,
  trafficSpeedMax: 11,
  /** Keep the curb lane clear of traffic spawns around pickup/drop-off points. */
  clearCurbLaneRadius: 55,
  /** Time limit = route length / this speed + slack. */
  timeLimitSpeed: 9,
  timeLimitSlack: 25,

  /** Scoring. */
  baseScore: 100,
  timeBonusPerSecond: 3,
  /** Stopping within this distance of the passenger earns a precision bonus. */
  precisePickupDistance: 4,
  precisionBonus: 40,
} as const;

export interface Destination {
  id: string;
  name: string;
  /** What the passenger says when boarding. */
  line: string;
  /** Big sign at the destination. */
  sign: string;
  kind: LandmarkKind;
}

const LINES_ONE = [
  "لو سمحت يا معلم، وصلني {p}.",
  "على {p} بسرعة الله يخليك، متأخر!",
  "ممكن توديني {p} يا أسطى؟",
  "عايز أروح {p}.. وما تزوّدش في الأجرة 😅",
  "{p} يا ريس، وعلى مهلك في المطبات.",
];
const LINES_TWO = [
  "إحنا الاتنين رايحين {p} يا معلم.",
  "وصلنا {p} الله يكرمك، مستعجلين!",
  "على {p} يا أسطى.. وشغّل لنا حاجة حلوة 🎶",
];

export function destinationFor(id: string, group: number, pick: number): Destination {
  const n = NODE_BY_ID.get(id)!;
  const lines = group > 1 ? LINES_TWO : LINES_ONE;
  return { id, name: n.name, sign: n.name, kind: n.kind, line: lines[pick % lines.length].replace("{p}", n.name) };
}

export const MISSION_TEXT = {
  intro: "في زبون مستنيك! قرّب منه ووقف عشان يركب",
  introGroup: "في زبونين مستنيينك! قرّب ووقف عشان يركبوا",
  pickupPrompt: "اقف هنا عشان الزبون يركب",
  holdPrompt: "خليك واقف.. بيركب",
  dropPrompt: "اقف في المكان المنوّر عشان ينزل",
  arrived: "وصلنا بالسلامة يا باشا!",
  thanks: ["تسلم إيدك يا معلم 🙏", "الله يكرمك يا أسطى!", "مشوار حلو.. شكراً يا ريس"],
  fail: {
    crash: { title: "خبطت يا أسطى! 💥", body: "الزبون نزل وقال: لا يا عم، أنا هكمّل مشي!" },
    timeout: { title: "اتأخرنا قوي ⏰", body: "الزبون زهق ونزل.. حاول تبقى أسرع المرة الجاية." },
    missedPassenger: { title: "فاتك الزبون! 😅", body: "لازم توقف جنبه في الحارة اليمين عشان يعرف يركب." },
    missedDrop: { title: "عدّيت المكان! 🙄", body: "الزبون كان عايز ينزل عند المكان المنوّر.. ونزل زعلان." },
  },
} as const;

export type FailReason = keyof typeof MISSION_TEXT.fail;
