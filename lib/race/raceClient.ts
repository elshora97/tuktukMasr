import type { Socket } from "socket.io-client";
import type { ClientToServer, RaceTick, RoomSnapshot, ServerToClient } from "./protocol";
import { RACE, normalizeRoomId, sanitizeName } from "./shared";

/**
 * Browser side of online races. socket.io-client is loaded lazily the first
 * time the player opens the race mode, so single-player never depends on it
 * (or on the race server being up).
 */
export type RaceScreen = "entry" | "lobby" | "race";
export type Connection = "idle" | "connecting" | "connected" | "reconnecting" | "offline";

export interface RaceUIState {
  screen: RaceScreen;
  connection: Connection;
  /** Arabic, user-facing. */
  error: string | null;
  notice: string | null;
  room: RoomSnapshot | null;
  myId: string | null;
  name: string;
  busy: boolean;
}

type RaceSocket = Socket<ServerToClient, ClientToServer>;

const NAME_KEY = "toktok-kobry:racer-name";
const SEAT_KEY = "toktok-kobry:race-seat";

export const ERRORS: Record<string, string> = {
  invalid: `كود الأوضة لازم يكون ${RACE.roomIdLength} حروف أو أرقام`,
  not_found: "مفيش أوضة بالكود ده.. اتأكد منه تاني",
  full: "الأوضة مليانة خلاص",
  started: "السباق بدأ في الأوضة دي.. استنى اللي بعده",
  closed: "الأوضة دي اتقفلت",
  name: "اكتب اسمك الأول يا كابتن",
  not_host: "صاحب الأوضة بس هو اللي يبدأ السباق",
  not_enough: `لازم يبقى فيه ${RACE.minPlayers} لاعيبة على الأقل`,
  not_ready: "لسه فيه حد مش جاهز",
  bad_phase: "مينفعش دلوقتي",
  server: "مش قادرين نوصل لسيرفر السباق.. جرّب تاني بعد شوية",
  timeout: "السيرفر مردّش.. جرّب تاني",
};

function readName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * URL of the race server: NEXT_PUBLIC_MULTIPLAYER_URL when set (deployments),
 * otherwise port 4000 on the same host the game was opened from — so local
 * `npm run dev` / `npm start` + `npm run race-server` work, also over LAN.
 */
export function serverUrl(): string | null {
  const env = process.env.NEXT_PUBLIC_MULTIPLAYER_URL?.trim().replace(/\/+$/, "");
  // Tolerate a bare host ("p01--x.code.run"): without a scheme, fetch() would
  // treat it as a path on the game's own site.
  if (env) return /^https?:\/\//i.test(env) ? env : `https://${env}`;
  if (typeof window === "undefined") return null;
  return `${window.location.protocol}//${window.location.hostname}:4000`;
}

// ---------------------------------------------------------------------------
// Mutable network state read by the render loop.

export const raceNet = {
  socket: null as RaceSocket | null,
  /** serverNow ≈ Date.now() + clockOffset */
  clockOffset: 0,
  /** Recent authoritative ticks (oldest first). */
  ticks: [] as { at: number; tick: RaceTick }[],
  token: null as string | null,
};

export function serverNow() {
  return Date.now() + raceNet.clockOffset;
}

// ---------------------------------------------------------------------------
// Store

const initial: RaceUIState = {
  screen: "entry",
  connection: "idle",
  error: null,
  notice: null,
  room: null,
  myId: null,
  name: "",
  busy: false,
};
let state = initial;
const listeners = new Set<() => void>();
function setState(patch: Partial<RaceUIState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const raceStore = {
  getState: () => state,
  getServerState: () => initial,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

let connecting: Promise<RaceSocket | null> | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function saveSeat(roomId: string, token: string) {
  raceNet.token = token;
  try {
    sessionStorage.setItem(SEAT_KEY, JSON.stringify({ roomId, token }));
  } catch {
    /* ignore */
  }
}
function clearSeat() {
  raceNet.token = null;
  try {
    sessionStorage.removeItem(SEAT_KEY);
  } catch {
    /* ignore */
  }
}
function readSeat(): { roomId: string; token: string } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(SEAT_KEY) ?? "null");
    return v && typeof v.roomId === "string" && typeof v.token === "string" ? v : null;
  } catch {
    return null;
  }
}

function showNotice(text: string) {
  if (noticeTimer) clearTimeout(noticeTimer);
  setState({ notice: text });
  noticeTimer = setTimeout(() => setState({ notice: null }), 3500);
}

/** Estimate the server clock offset from a few round trips (lowest RTT wins). */
async function syncClock(socket: RaceSocket) {
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const serverT = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 1500);
      socket.emit("time:ping", t0, (s) => {
        clearTimeout(timer);
        resolve(s);
      });
    });
    if (serverT === null) continue;
    const t1 = Date.now();
    const rtt = t1 - t0;
    if (rtt < best) {
      best = rtt;
      raceNet.clockOffset = serverT + rtt / 2 - t1;
    }
  }
}

function applyRoom(room: RoomSnapshot) {
  setState({ room, screen: room.phase === "lobby" ? "lobby" : "race" });
}

async function ensureSocket(): Promise<RaceSocket | null> {
  if (raceNet.socket?.connected) return raceNet.socket;
  if (connecting) return connecting;
  const url = serverUrl();
  if (!url) {
    setState({ connection: "offline", error: ERRORS.server });
    return null;
  }
  setState({ connection: "connecting", error: null });
  connecting = (async () => {
    try {
      const { io } = await import("socket.io-client");
      const socket: RaceSocket = raceNet.socket ?? io(url, { transports: ["websocket", "polling"], reconnectionDelayMax: 4000, timeout: 6000 });
      raceNet.socket = socket;
      if (!socket.hasListeners("room:state")) {
        socket.on("room:state", (room) => {
          if (state.room && room.id !== state.room.id) return;
          applyRoom(room);
        });
        socket.on("race:tick", (tick) => {
          raceNet.ticks.push({ at: Date.now(), tick });
          if (raceNet.ticks.length > 30) raceNet.ticks.shift();
        });
        socket.on("room:closed", ({ reason }) => {
          clearSeat();
          setState({ room: null, screen: "entry", error: reason === "host_closed" ? "صاحب الأوضة قفلها" : "الأوضة اتقفلت" });
        });
        socket.on("room:notice", ({ kind, name }) => {
          showNotice(kind === "host_changed" ? `${name} بقى صاحب الأوضة 👑` : `${name} خرج من الأوضة`);
        });
        socket.on("disconnect", () => {
          if (state.room) setState({ connection: "reconnecting" });
        });
        socket.on("connect", () => {
          void syncClock(socket);
          setState({ connection: "connected", error: null });
          // Re-claim our seat after a reconnect.
          const seat = readSeat();
          if (state.room && seat) {
            socket.emit("room:join", { roomId: seat.roomId, name: state.name, token: seat.token }, (res) => {
              if (res.ok) {
                setState({ myId: res.you.id });
                applyRoom(res.room);
              } else {
                clearSeat();
                setState({ room: null, screen: "entry", error: ERRORS[res.error] ?? ERRORS.server });
              }
            });
          }
        });
      }
      if (!socket.connected) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("timeout")), 7000);
          socket.once("connect", () => {
            clearTimeout(timer);
            resolve();
          });
          socket.once("connect_error", (err) => {
            clearTimeout(timer);
            reject(err);
          });
          socket.connect();
        });
      }
      await syncClock(socket);
      setState({ connection: "connected" });
      return socket;
    } catch {
      raceNet.socket?.disconnect();
      raceNet.socket = null;
      setState({ connection: "offline", error: ERRORS.server });
      return null;
    } finally {
      connecting = null;
    }
  })();
  return connecting;
}

function emitWithTimeout<T>(fn: (done: (v: T) => void) => void, ms = 6000): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    fn((v) => {
      clearTimeout(timer);
      resolve(v);
    });
  });
}

export const raceActions = {
  /** Called when the race menu opens: restore the name, try to reclaim a seat. */
  async open() {
    setState({ name: state.name || readName(), error: null });
    const seat = readSeat();
    if (seat && !state.room) {
      const socket = await ensureSocket();
      if (!socket) return;
      const res = await emitWithTimeout<Parameters<Parameters<ClientToServer["room:join"]>[1]>[0]>((done) =>
        socket.emit("room:join", { roomId: seat.roomId, name: state.name || "لاعب", token: seat.token }, done),
      );
      if (res?.ok) {
        raceNet.token = res.you.token;
        setState({ myId: res.you.id });
        applyRoom(res.room);
      } else clearSeat();
    }
  },

  setName(name: string) {
    setState({ name });
    try {
      localStorage.setItem(NAME_KEY, sanitizeName(name));
    } catch {
      /* ignore */
    }
  },

  clearError() {
    setState({ error: null });
  },

  async createRoom() {
    const name = sanitizeName(state.name);
    if (!name) return setState({ error: ERRORS.name });
    setState({ busy: true, error: null });
    const socket = await ensureSocket();
    if (!socket) return setState({ busy: false });
    const res = await emitWithTimeout<Parameters<Parameters<ClientToServer["room:create"]>[1]>[0]>((done) => socket.emit("room:create", { name }, done));
    if (!res) return setState({ busy: false, error: ERRORS.timeout });
    if (!res.ok) return setState({ busy: false, error: ERRORS[res.error] ?? ERRORS.server });
    saveSeat(res.room.id, res.you.token);
    raceNet.ticks = [];
    setState({ busy: false, myId: res.you.id });
    applyRoom(res.room);
  },

  async joinRoom(rawId: string) {
    const name = sanitizeName(state.name);
    if (!name) return setState({ error: ERRORS.name });
    const roomId = normalizeRoomId(rawId);
    if (roomId.length !== RACE.roomIdLength) return setState({ error: ERRORS.invalid });
    setState({ busy: true, error: null });
    const socket = await ensureSocket();
    if (!socket) return setState({ busy: false });
    const res = await emitWithTimeout<Parameters<Parameters<ClientToServer["room:join"]>[1]>[0]>((done) => socket.emit("room:join", { roomId, name }, done));
    if (!res) return setState({ busy: false, error: ERRORS.timeout });
    if (!res.ok) return setState({ busy: false, error: ERRORS[res.error] ?? ERRORS.server });
    saveSeat(res.room.id, res.you.token);
    raceNet.ticks = [];
    setState({ busy: false, myId: res.you.id });
    applyRoom(res.room);
  },

  leave() {
    raceNet.socket?.emit("room:leave");
    clearSeat();
    raceNet.ticks = [];
    setState({ room: null, screen: "entry", myId: null });
  },

  setReady(ready: boolean) {
    raceNet.socket?.emit("room:ready", { ready });
  },

  async start() {
    const socket = raceNet.socket;
    if (!socket) return;
    setState({ busy: true, error: null });
    const res = await emitWithTimeout<{ ok: boolean; error?: string }>((done) => socket.emit("room:start", done));
    setState({ busy: false, error: !res ? ERRORS.timeout : res.ok ? null : (ERRORS[res.error ?? ""] ?? ERRORS.server) });
  },

  closeRoom() {
    raceNet.socket?.emit("room:close");
  },

  raceAgain() {
    raceNet.socket?.emit("race:again");
  },

  sendInput(x: number, t: number) {
    if (raceNet.socket?.connected) raceNet.socket.emit("race:input", { x, t: Math.round(t * 1000) / 1000 });
  },

  /** Report a crash / coin pickup / nitro press at race time t (server validates). */
  sendEvent(kind: "hit" | "nitro" | "coin", t: number, i?: number) {
    if (raceNet.socket?.connected) raceNet.socket.emit("race:event", { kind, t: Math.round(t * 1000) / 1000, i });
  },

  /** Leave the race mode entirely (back to the main menu). */
  exit() {
    if (state.room) raceActions.leave();
    raceNet.socket?.disconnect();
    raceNet.socket = null;
    setState({ connection: "idle", error: null, screen: "entry" });
  },
};
