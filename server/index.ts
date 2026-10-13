/**
 * توكتوك كوبري مصر — authoritative multiplayer race server (Socket.IO).
 *
 *   PORT           listen port (default 4000)
 *   CORS_ORIGIN    comma-separated allowed origins (default: allow all — dev only)
 *   RACE_DISTANCE  optional course length override in meters (testing)
 */
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { ClientToServer, JoinError, ServerToClient } from "../lib/race/protocol";
import { RACE, ROOM_ID_RE, normalizeRoomId, sanitizeName } from "../lib/race/shared";
import {
  addPlayer,
  backToLobby,
  beginCountdown,
  canStart,
  createRoom,
  members,
  migrateHost,
  newRoomId,
  simulate,
  snapshot,
  tick,
  type Room,
  type ServerPlayer,
} from "./rooms";

const PORT = Number(process.env.PORT ?? 4000);
const ORIGINS = (process.env.CORS_ORIGIN ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const DISTANCE = Math.max(200, Math.min(10000, Number(process.env.RACE_DISTANCE) || RACE.distance));

type GameSocket = Socket<ClientToServer, ServerToClient>;

const rooms = new Map<string, Room>();
/** socket.id -> { roomId, playerId } */
const seats = new Map<string, { roomId: string; playerId: string }>();

const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: seats.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server<ClientToServer, ServerToClient>(http, {
  cors: { origin: ORIGINS.includes("*") ? true : ORIGINS, methods: ["GET", "POST"] },
  pingInterval: 10000,
  pingTimeout: 8000,
  maxHttpBufferSize: 16 * 1024,
});

function broadcast(room: Room) {
  room.lastActive = Date.now();
  io.to(room.id).emit("room:state", snapshot(room));
}

function seatOf(socket: GameSocket) {
  const seat = seats.get(socket.id);
  if (!seat) return null;
  const room = rooms.get(seat.roomId);
  const player = room?.players.get(seat.playerId);
  if (!room || !player) return null;
  return { room, player };
}

function closeRoom(room: Room, reason: "host_closed" | "empty" | "expired") {
  io.to(room.id).emit("room:closed", { reason });
  for (const p of room.players.values()) {
    if (p.socketId) {
      seats.delete(p.socketId);
      io.sockets.sockets.get(p.socketId)?.leave(room.id);
    }
  }
  rooms.delete(room.id);
}

/** Remove a player for good (explicit leave or expired grace). */
function removePlayer(room: Room, player: ServerPlayer) {
  if (player.socketId) {
    seats.delete(player.socketId);
    io.sockets.sockets.get(player.socketId)?.leave(room.id);
  }
  player.socketId = null;
  player.connected = false;
  if (room.phase === "racing" || room.phase === "countdown") {
    // Keep them in the race results as "left".
    player.left = true;
  } else {
    room.players.delete(player.id);
  }
  if (members(room).length === 0) {
    closeRoom(room, "empty");
    return;
  }
  if (room.hostId === player.id) {
    const next = migrateHost(room);
    if (next) io.to(room.id).emit("room:notice", { kind: "host_changed", name: next.name });
  } else {
    io.to(room.id).emit("room:notice", { kind: "player_left", name: player.name });
  }
  broadcast(room);
}

function attach(socket: GameSocket, room: Room, player: ServerPlayer) {
  // One seat per socket.
  const prev = seats.get(socket.id);
  if (prev && (prev.roomId !== room.id || prev.playerId !== player.id)) {
    const r = rooms.get(prev.roomId);
    const p = r?.players.get(prev.playerId);
    if (r && p) removePlayer(r, p);
  }
  if (player.socketId && player.socketId !== socket.id) {
    // Same player reconnecting from a new socket: drop the stale one.
    seats.delete(player.socketId);
    io.sockets.sockets.get(player.socketId)?.leave(room.id);
  }
  player.socketId = socket.id;
  player.connected = true;
  player.disconnectedAt = 0;
  seats.set(socket.id, { roomId: room.id, playerId: player.id });
  void socket.join(room.id);
}

io.on("connection", (socket) => {
  socket.on("time:ping", (clientNow, ack) => {
    void clientNow;
    if (typeof ack === "function") ack(Date.now());
  });

  socket.on("room:create", (req, ack) => {
    if (typeof ack !== "function") return;
    const name = sanitizeName(req?.name);
    if (!name) return ack({ ok: false, error: "name" satisfies JoinError });
    const room = createRoom(newRoomId(rooms), Date.now(), DISTANCE);
    rooms.set(room.id, room);
    const player = addPlayer(room, name, Date.now());
    attach(socket, room, player);
    ack({ ok: true, room: snapshot(room), you: { id: player.id, token: player.token } });
    broadcast(room);
  });

  socket.on("room:join", (req, ack) => {
    if (typeof ack !== "function") return;
    const roomId = normalizeRoomId(String(req?.roomId ?? ""));
    if (!ROOM_ID_RE.test(roomId)) return ack({ ok: false, error: "invalid" satisfies JoinError });
    const room = rooms.get(roomId);
    if (!room) return ack({ ok: false, error: "not_found" satisfies JoinError });
    // Reconnect with a token: restore the same seat (works mid-race too).
    if (typeof req?.token === "string" && req.token.length > 0) {
      const existing = [...room.players.values()].find((p) => p.token === req.token && !p.left);
      if (existing) {
        attach(socket, room, existing);
        ack({ ok: true, room: snapshot(room), you: { id: existing.id, token: existing.token } });
        broadcast(room);
        return;
      }
    }
    const name = sanitizeName(req?.name);
    if (!name) return ack({ ok: false, error: "name" satisfies JoinError });
    if (room.phase !== "lobby") return ack({ ok: false, error: "started" satisfies JoinError });
    if (members(room).length >= RACE.maxPlayers) return ack({ ok: false, error: "full" satisfies JoinError });
    const player = addPlayer(room, name, Date.now());
    attach(socket, room, player);
    ack({ ok: true, room: snapshot(room), you: { id: player.id, token: player.token } });
    broadcast(room);
  });

  socket.on("room:leave", () => {
    const seat = seatOf(socket);
    if (seat) removePlayer(seat.room, seat.player);
  });

  socket.on("room:ready", (req) => {
    const seat = seatOf(socket);
    if (!seat || seat.room.phase !== "lobby") return;
    seat.player.ready = req?.ready === true;
    broadcast(seat.room);
  });

  socket.on("room:start", (ack) => {
    if (typeof ack !== "function") return;
    const seat = seatOf(socket);
    if (!seat) return ack({ ok: false, error: "bad_phase" });
    if (seat.room.hostId !== seat.player.id) return ack({ ok: false, error: "not_host" });
    const check = canStart(seat.room);
    if (check !== "ok") return ack({ ok: false, error: check });
    beginCountdown(seat.room, Date.now());
    ack({ ok: true });
    broadcast(seat.room);
  });

  socket.on("room:close", () => {
    const seat = seatOf(socket);
    if (seat && seat.room.hostId === seat.player.id) closeRoom(seat.room, "host_closed");
  });

  socket.on("race:again", () => {
    const seat = seatOf(socket);
    if (!seat || seat.room.phase !== "results" || seat.room.hostId !== seat.player.id) return;
    backToLobby(seat.room);
    broadcast(seat.room);
  });

  socket.on("race:input", (req) => {
    const seat = seatOf(socket);
    if (!seat) return;
    const { player } = seat;
    const now = Date.now();
    if (now - player.inputWindowStart > 1000) {
      player.inputWindowStart = now;
      player.inputCount = 0;
    }
    if (++player.inputCount > 60) return; // flood guard
    const x = Number(req?.x);
    if (!Number.isFinite(x)) return;
    player.inputX = Math.max(-10, Math.min(10, x));
    player.lastInputAt = now;
  });

  socket.on("disconnect", () => {
    const seat = seatOf(socket);
    seats.delete(socket.id);
    if (!seat) return;
    const { room, player } = seat;
    if (player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    player.disconnectedAt = Date.now();
    if (room.hostId === player.id && room.phase === "lobby") {
      // Hand the lobby to someone who is still here; the old host keeps their seat for the grace period.
      const others = members(room).filter((p) => p.connected);
      if (others.length > 0) {
        const next = migrateHost(room);
        if (next) io.to(room.id).emit("room:notice", { kind: "host_changed", name: next.name });
      }
    }
    broadcast(room);
  });
});

// --- Simulation + housekeeping loops

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.phase !== "countdown" && room.phase !== "racing") continue;
    const before = room.phase;
    const { ended } = simulate(room, now);
    if (room.phase === "racing") io.to(room.id).emit("race:tick", tick(room));
    if (ended || before !== room.phase) broadcast(room);
  }
}, 1000 / RACE.tickHz);

setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    // Expire disconnected players after the reconnect grace window.
    for (const p of [...room.players.values()]) {
      if (!p.connected && !p.left && p.disconnectedAt && now - p.disconnectedAt > RACE.reconnectGraceMs) {
        removePlayer(room, p);
        if (!rooms.has(room.id)) break;
      }
    }
    if (!rooms.has(room.id)) continue;
    const anyone = members(room).some((p) => p.connected);
    if (!anyone && now - room.lastActive > RACE.reconnectGraceMs) closeRoom(room, "empty");
    else if (now - room.lastActive > RACE.roomIdleMs && room.phase !== "racing") closeRoom(room, "expired");
  }
}, 2000);

http.listen(PORT, () => {
  console.log(`[race-server] listening on :${PORT} (distance ${DISTANCE} m, origins: ${ORIGINS.join(", ")})`);
});
