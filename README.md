# توكتوك كوبري مصر 🛺

An Egyptian tuk-tuk game on a Cairo bridge. It's built with Next.js, React Three Fiber and Tailwind, plus a small Socket.IO server for online races.

## Game modes

| Mode | What it is |
| --- | --- |
| **اللعب الفردي** | Endless driving on the bridge: dodge traffic, overtake cars, beat your best score. Only genuinely close passes show a small label. |
| **سباق مع صحابك 🏁** | Real-time online race. Create a private room, share the 5-character code, ready up, and race a 2.4 km course. |
| **وصلني يا معلم 🛺** | Passenger missions on a city street with turns. Stop next to the waving passenger to pick them up, follow the route to their destination, and stop in the lit zone to drop them off. |

Controls: drag a finger left/right anywhere on the screen, or use the mouse, ←/→ (or A/D). ↓ (or S) or the on-screen «فرامل» pedal brakes (missions). Space/H honks, and P/Esc pauses (except in online races).

## Running locally

```bash
npm install
npm run dev          # the game, http://localhost:3000
npm run dev:race     # the race server, http://localhost:4000 (only needed for online races)
```

Single player and missions work without the race server. In development the client connects to `http://<same host>:4000` automatically, so phones on your LAN can open `http://<your-PC-IP>:3000` and race too.

Other scripts: `npm run typecheck`, `npm run lint`, `npm run build`, `npm start`, `npm run race-server` (no file watching).

## Architecture

```
app/                      Next.js entry, PWA manifest, fonts
components/game/          bridge world, traffic, tuk-tuk, endless-mode UI, canvas + camera
components/mission/       passenger mode: street world, controller (state machine), traffic, passenger, HUD
components/race/          online race: scene (prediction, interpolation, traffic, finish line), lobby, HUD
lib/gameStore.ts          endless-mode store + `runtime` (per-frame mutable state, incl. the tuk-tuk pose)
lib/mission/              route generation (straights + arcs), mission config, state machine store
lib/race/shared.ts        race rules, deterministic traffic, racer simulation, used by BOTH client and server
lib/race/protocol.ts      Socket.IO message types
lib/race/raceClient.ts    lazy socket connection, clock sync, lobby/race store
lib/screenAnchors.ts      DOM labels pinned to 3D objects (overtake labels, name tags)
server/                   authoritative race server (Node + Socket.IO, run with tsx)
```

Per-frame values (positions, speed, timers) live in mutable objects read inside `useFrame` or `requestAnimationFrame`. React state only changes on real UI events: score, phase changes, lobby updates.

### Online races: how fairness works

- The server creates rooms, assigns each connection a random player id and a reconnect token, and owns readiness, the countdown, the race state and the results.
- Traffic is generated from the room's seed, and every traffic car moves at the same speed. All racers face the identical obstacle course, and a spawn-time check guarantees that one lane is always passable.
- Clients send only their steering position. The server re-simulates every racer with `lib/race/shared.ts` at 60 Hz: forward progress, crashes (a 1.3 s spin-out and then brief invulnerability) and finish times. It broadcasts snapshots at 20 Hz. Steering speed is clamped, inputs are rate-limited and validated, and a client can never report its own position or a win.
- Clients predict locally with the same code and reconcile against the snapshots. Other racers are drawn 120 ms in the past, interpolated between snapshots.
- Disconnects keep a player's seat for 20 s (the reconnect restores the seat, even mid-race). If the host leaves, the longest-standing remaining player becomes host. Empty or idle rooms are cleaned up automatically.

## Configuration

See `.env.example`.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_MULTIPLAYER_URL` | game (build time) | Public URL of the race server, e.g. `https://toktok-race.onrender.com`. **Required in production** for online races. |
| `PORT` | race server | Listen port (default 4000; most hosts set it for you). |
| `CORS_ORIGIN` | race server | Comma-separated allowed origins, e.g. `https://toktok.vercel.app`. Defaults to `*` (dev only). |
| `DATA_DIR` | race server | Where the endless-mode high scores (`leaderboard.json`) are saved. Default `data` (`/app/data` in `Dockerfile.race`). Mount a persistent volume there to keep records across deploys. |
| `ADMIN_TOKEN` | race server | Optional secret that lets you remove one leaderboard record: `curl -X DELETE <server>/leaderboard/<id> -H "Authorization: Bearer <token>"` (ids are in `GET /leaderboard`). Unset = no delete. |
| `RACE_DISTANCE` | race server | Optional course length in meters (default 2400), handy for testing. |

## Deploying

The game and the race server are **two services**. Serverless Next.js hosting (Vercel, Netlify functions) cannot hold persistent WebSocket connections, so the race server needs a host that runs a long-lived Node process.

### 1. Race server (Render, Railway, Fly.io, or any VPS)

- **Build command:** `npm install`
- **Start command:** `npm run race-server`
- **Environment:** `CORS_ORIGIN=https://<your-game-domain>` (the host usually sets `PORT`)
- **Health check:** `GET /health`
- Use **one instance**. Rooms live in memory, so don't scale horizontally without adding a shared adapter, e.g. the Socket.IO Redis adapter.

### 2. Game (Vercel, or any Next.js host)

- Set `NEXT_PUBLIC_MULTIPLAYER_URL=https://<your-race-server>` **before building**; it is baked into the client bundle.
- Build `npm run build`, then serve with `npm start` (or let Vercel do it).
- The game is a PWA: it's installable and plays offline. Online races of course need a connection.

If the race server is unreachable, the race menu shows «مش قادرين نوصل لسيرفر السباق». Single player and missions keep working.
