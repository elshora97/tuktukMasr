import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { PLAYER } from "../lib/gameConfig";
import type { PlayerInfo, RaceResult, RaceTick, RoomPhase, RoomSnapshot } from "../lib/race/protocol";
import {
  RACE,
  ROOM_ID_ALPHABET,
  generateRaceCoins,
  generateRaceTraffic,
  type RaceCoin,
  makeRacer,
  startX,
  stepRacer,
  type RaceCar,
  type RacerSim,
} from "../lib/race/shared";

export interface ServerPlayer {
  id: string;
  token: string;
  name: string;
  ready: boolean;
  paint: number;
  slot: number;
  socketId: string | null;
  connected: boolean;
  /** When the socket dropped (ms), for the reconnect grace window. */
  disconnectedAt: number;
  /** Left for good during a race (kept for results). */
  left: boolean;
  joinedAt: number;
  sim: RacerSim;
  /** Steering samples stamped with the client's race time (oldest first). */
  inputs: { t: number; x: number }[];
  /** Race time this player's sim has reached (lags room.simT by their latency). */
  simT: number;
  lastInputAt: number;
  /** Simple flood protection for inputs. */
  inputWindowStart: number;
  inputCount: number;
}

export interface Room {
  id: string;
  hostId: string;
  phase: RoomPhase;
  players: Map<string, ServerPlayer>;
  seed: number;
  distance: number;
  traffic: RaceCar[];
  coins: RaceCoin[];
  startAt: number | null;
  results: RaceResult[] | null;
  raceId: number;
  createdAt: number;
  lastActive: number;
  firstFinishAt: number | null;
  /** Server time of the last simulated step. */
  simT: number;
}

export function newRoomId(existing: Map<string, Room>): string {
  for (;;) {
    let id = "";
    for (let i = 0; i < RACE.roomIdLength; i++) id += ROOM_ID_ALPHABET[randomInt(ROOM_ID_ALPHABET.length)];
    if (!existing.has(id)) return id;
  }
}

export function createRoom(id: string, now: number, distance: number): Room {
  const seed = randomInt(1, 2 ** 31 - 1);
  return {
    id,
    hostId: "",
    phase: "lobby",
    players: new Map(),
    seed,
    distance,
    traffic: generateRaceTraffic(seed, distance),
    coins: generateRaceCoins(seed, distance),
    startAt: null,
    results: null,
    raceId: 0,
    createdAt: now,
    lastActive: now,
    firstFinishAt: null,
    simT: 0,
  };
}

export function addPlayer(room: Room, name: string, now: number): ServerPlayer {
  const usedPaint = new Set([...room.players.values()].map((p) => p.paint));
  const usedSlot = new Set([...room.players.values()].map((p) => p.slot));
  let paint = 0;
  while (usedPaint.has(paint)) paint++;
  let slot = 0;
  while (usedSlot.has(slot)) slot++;
  const p: ServerPlayer = {
    id: randomUUID(),
    token: randomBytes(18).toString("hex"),
    name,
    ready: false,
    paint,
    slot,
    socketId: null,
    connected: true,
    disconnectedAt: 0,
    left: false,
    joinedAt: now,
    sim: makeRacer(),
    inputs: [],
    simT: 0,
    lastInputAt: 0,
    inputWindowStart: now,
    inputCount: 0,
  };
  room.players.set(p.id, p);
  if (!room.hostId) room.hostId = p.id;
  return p;
}

/** Remaining members who count (not permanently left). */
export function members(room: Room) {
  return [...room.players.values()].filter((p) => !p.left);
}

/** Pick the longest-standing connected member as host. Returns the new host or null. */
export function migrateHost(room: Room): ServerPlayer | null {
  const candidates = members(room)
    .filter((p) => p.connected)
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const next = candidates[0] ?? members(room).sort((a, b) => a.joinedAt - b.joinedAt)[0] ?? null;
  room.hostId = next?.id ?? "";
  return next;
}

export function canStart(room: Room): "ok" | "not_enough" | "not_ready" | "bad_phase" {
  if (room.phase !== "lobby") return "bad_phase";
  const ms = members(room).filter((p) => p.connected);
  if (ms.length < RACE.minPlayers) return "not_enough";
  // Everyone except the host must have pressed ready (the host starts the race).
  if (ms.some((p) => p.id !== room.hostId && !p.ready)) return "not_ready";
  return "ok";
}

export function beginCountdown(room: Room, now: number) {
  room.phase = "countdown";
  room.raceId++;
  room.startAt = now + RACE.countdownMs;
  room.results = null;
  room.firstFinishAt = null;
  room.simT = 0;
  for (const p of members(room)) {
    p.sim = makeRacer();
    p.sim.x = startX(p.slot);
    p.inputs = [];
    p.simT = 0;
  }
}

export function backToLobby(room: Room) {
  room.phase = "lobby";
  room.startAt = null;
  room.results = null;
  room.seed = randomInt(1, 2 ** 31 - 1);
  room.traffic = generateRaceTraffic(room.seed, room.distance);
  room.coins = generateRaceCoins(room.seed, room.distance);
  // Drop players who left mid-race; everyone re-readies.
  for (const [id, p] of room.players) if (p.left) room.players.delete(id);
  for (const p of room.players.values()) p.ready = false;
}

const SIM_STEP = 1 / 60;
/** How far a player's sim may trail the room clock while waiting for their inputs. */
const MAX_INPUT_LAG = 0.4;

/** Steering x the client had at race time t (interpolated between samples). */
function inputAt(p: ServerPlayer, t: number): number | null {
  const q = p.inputs;
  while (q.length > 2 && q[1].t <= t) q.shift();
  if (q.length === 0) return null;
  if (t <= q[0].t) return q[0].x;
  const a = q[0];
  const b = q[1];
  if (!b) return a.x;
  return a.x + ((b.x - a.x) * (t - a.t)) / Math.max(1e-6, b.t - a.t);
}

/** Advance the authoritative race to `now` in fixed 60 Hz steps; reports whether the race just ended. */
export function simulate(room: Room, now: number): { ended: boolean } {
  if (room.startAt === null) return { ended: false };
  if (room.phase === "countdown" && now >= room.startAt) room.phase = "racing";
  if (room.phase !== "racing") return { ended: false };
  const target = (now - room.startAt) / 1000;
  const maxLat = RACE.maxLateralSpeed;
  room.simT = Math.max(room.simT, target);
  for (const p of members(room)) {
    // Each racer is simulated with the exact x their client had at each race time, so a
    // close dodge on screen is a dodge here too (no hits from latency-delayed steering).
    // A silent client is advanced anyway once it trails by MAX_INPUT_LAG.
    const lastT = p.inputs.length ? p.inputs[p.inputs.length - 1].t : -Infinity;
    const until = Math.min(target, Math.max(lastT, target - MAX_INPUT_LAG));
    while (p.simT + SIM_STEP <= until) {
      p.simT += SIM_STEP;
      const want = inputAt(p, p.simT) ?? p.sim.x;
      // Speed-limited (with slack for frame jitter) so clients can't teleport.
      const lim = maxLat * SIM_STEP * 1.6;
      const dx = Math.max(-lim, Math.min(lim, want - p.sim.x));
      const x = Math.max(-PLAYER.xLimit, Math.min(PLAYER.xLimit, p.sim.x + dx));
      const wasFinished = p.sim.finished;
      stepRacer(p.sim, x, SIM_STEP, p.simT, room.traffic, room.distance, room.coins);
      if (!wasFinished && p.sim.finished && room.firstFinishAt === null) room.firstFinishAt = now;
    }
  }
  const racers = members(room);
  const allDone = racers.every((p) => p.sim.finished || !p.connected);
  const graceOver = room.firstFinishAt !== null && now - room.firstFinishAt > RACE.finishGraceS * 1000;
  const timeUp = target > RACE.maxRaceS;
  if ((allDone && racers.some((p) => p.sim.finished)) || graceOver || timeUp || racers.length === 0) {
    finishRace(room);
    return { ended: true };
  }
  return { ended: false };
}

export function finishRace(room: Room) {
  const all = [...room.players.values()];
  const finished = all.filter((p) => p.sim.finished).sort((a, b) => (a.sim.finishTime ?? 0) - (b.sim.finishTime ?? 0));
  const dnf = all.filter((p) => !p.sim.finished).sort((a, b) => b.sim.d - a.sim.d);
  room.results = [...finished, ...dnf].map((p, i) => ({
    id: p.id,
    name: p.name,
    place: i + 1,
    finished: p.sim.finished,
    time: p.sim.finishTime === null ? null : Math.round(p.sim.finishTime * 100) / 100,
    distance: Math.round(Math.min(p.sim.d, room.distance)),
    hits: p.sim.hits,
    coins: p.sim.coins,
    left: p.left,
  }));
  room.phase = "results";
}

export function tick(room: Room): RaceTick {
  return {
    raceId: room.raceId,
    t: room.simT,
    players: members(room).map((p) => ({
      id: p.id,
      d: round2(p.sim.d),
      pt: Math.round(p.simT * 1000) / 1000,
      x: round2(p.sim.x),
      speed: round2(p.sim.speed),
      stun: round2(p.sim.stun),
      ghost: round2(p.sim.ghost),
      nitro: round2(p.sim.nitro),
      coins: p.sim.coins,
      finished: p.sim.finished,
      finishTime: p.sim.finishTime,
    })),
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function snapshot(room: Room): RoomSnapshot {
  const players: PlayerInfo[] = members(room)
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((p) => ({ id: p.id, name: p.name, ready: p.ready, connected: p.connected, paint: p.paint, slot: p.slot }));
  return {
    id: room.id,
    phase: room.phase,
    hostId: room.hostId,
    players,
    minPlayers: RACE.minPlayers,
    maxPlayers: RACE.maxPlayers,
    seed: room.seed,
    distance: room.distance,
    startAt: room.startAt,
    results: room.results,
    raceId: room.raceId,
  };
}
