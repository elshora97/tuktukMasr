/** Wire protocol between the race client and the Socket.IO race server. */

export type RoomPhase = "lobby" | "countdown" | "racing" | "results";

export interface PlayerInfo {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
  /** Index into TUKTUK_PAINTS. */
  paint: number;
  /** Starting slot (lane spread). */
  slot: number;
}

export interface RaceResult {
  id: string;
  name: string;
  place: number;
  finished: boolean;
  /** Finish time in seconds, null if not finished (DNF). */
  time: number | null;
  /** Meters covered (for DNF ordering). */
  distance: number;
  hits: number;
  left: boolean;
}

export interface RoomSnapshot {
  id: string;
  phase: RoomPhase;
  hostId: string;
  players: PlayerInfo[];
  minPlayers: number;
  maxPlayers: number;
  /** Course seed + length for the current/next race. */
  seed: number;
  distance: number;
  /** Server epoch ms when the race starts (green light), or null. */
  startAt: number | null;
  results: RaceResult[] | null;
  /** Bumps each race so clients reset their simulation. */
  raceId: number;
}

export interface TickPlayer {
  id: string;
  d: number;
  x: number;
  speed: number;
  stun: number;
  ghost: number;
  finished: boolean;
  finishTime: number | null;
}

export interface RaceTick {
  raceId: number;
  /** Race time in seconds (server authority). */
  t: number;
  players: TickPlayer[];
}

export type JoinError = "invalid" | "not_found" | "full" | "started" | "closed" | "name" | "server";
export type StartError = "not_host" | "not_enough" | "not_ready" | "bad_phase";

export type Ack<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface ServerToClient {
  "room:state": (room: RoomSnapshot) => void;
  "race:tick": (tick: RaceTick) => void;
  "room:closed": (info: { reason: "host_closed" | "empty" | "expired" }) => void;
  "room:notice": (info: { kind: "host_changed" | "player_left"; name: string }) => void;
}

export interface ClientToServer {
  "room:create": (req: { name: string }, ack: (res: Ack<{ room: RoomSnapshot; you: { id: string; token: string } }>) => void) => void;
  "room:join": (
    req: { roomId: string; name: string; token?: string },
    ack: (res: Ack<{ room: RoomSnapshot; you: { id: string; token: string } }>) => void,
  ) => void;
  "room:leave": () => void;
  "room:ready": (req: { ready: boolean }) => void;
  "room:start": (ack: (res: Ack<object>) => void) => void;
  "room:close": () => void;
  "race:again": () => void;
  "race:input": (req: { x: number }) => void;
  "time:ping": (clientNow: number, ack: (serverNow: number) => void) => void;
}
