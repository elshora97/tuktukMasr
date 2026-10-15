import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sanitizeName } from "../lib/race/shared";
import type { LeaderboardEntry, LeaderboardResponse } from "../lib/leaderboardTypes";

/**
 * High scores for the endless mode («اللعب الفردي»), shared by every player.
 *
 *   GET  /leaderboard          → { entries: top 20 }
 *   POST /leaderboard {name, score, distance, overtakes}
 *                              → { entries, id, rank }
 *
 * Kept in memory and written to DATA_DIR/leaderboard.json (atomic rename),
 * so it survives restarts when DATA_DIR is on a persistent volume.
 */
const FILE = join(process.env.DATA_DIR ?? "data", "leaderboard.json");
const KEEP = 200;
const SHOW = 20;
const LIMITS = { score: 1_000_000, distance: 1_000_000, overtakes: 100_000 };
/** One submission per IP per window. */
const RATE_MS = 8000;

let entries: LeaderboardEntry[] = [];
try {
  const raw = JSON.parse(readFileSync(FILE, "utf8"));
  if (Array.isArray(raw)) entries = raw.filter((e) => e && typeof e.name === "string" && Number.isFinite(e.score));
} catch {
  /* first run */
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(FILE + ".tmp", JSON.stringify(entries));
      renameSync(FILE + ".tmp", FILE);
    } catch (err) {
      console.error("[leaderboard] save failed", err);
    }
  }, 500);
}

const sorted = () => entries.sort((a, b) => b.score - a.score || a.at - b.at);
const lastPost = new Map<string, number>();

function send(res: ServerResponse, status: number, body: unknown, cors: string | null) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...(cors ? { "Access-Control-Allow-Origin": cors, Vary: "Origin" } : {}),
  });
  res.end(JSON.stringify(body));
}

function int(v: unknown, max: number): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n) : null;
}

/** Handles /leaderboard; returns false for other paths. `cors` = allowed origin to echo, or null. */
export function handleLeaderboard(req: IncomingMessage, res: ServerResponse, cors: string | null): boolean {
  if (!req.url || req.url.split("?")[0] !== "/leaderboard") return false;
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...(cors ? { "Access-Control-Allow-Origin": cors, Vary: "Origin" } : {}),
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return true;
  }
  if (req.method === "GET") {
    const body: LeaderboardResponse = { entries: sorted().slice(0, SHOW) };
    send(res, 200, body, cors);
    return true;
  }
  if (req.method !== "POST") {
    send(res, 405, { error: "method" }, cors);
    return true;
  }
  // Last hop = the address our proxy saw (earlier ones are client-supplied).
  const ip = (req.headers["x-forwarded-for"]?.toString().split(",").pop() ?? req.socket.remoteAddress ?? "?").trim();
  const now = Date.now();
  if (now - (lastPost.get(ip) ?? 0) < RATE_MS) {
    send(res, 429, { error: "slow_down" }, cors);
    return true;
  }
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk: string) => {
    raw += chunk;
    if (raw.length > 2000) req.destroy();
  });
  req.on("end", () => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: "json" }, cors);
    }
    const name = sanitizeName(data.name);
    const score = int(data.score, LIMITS.score);
    const distance = int(data.distance, LIMITS.distance);
    const overtakes = int(data.overtakes, LIMITS.overtakes);
    if (!name) return send(res, 400, { error: "name" }, cors);
    if (score === null || score <= 0 || distance === null || overtakes === null) return send(res, 400, { error: "score" }, cors);
    lastPost.set(ip, now);
    if (lastPost.size > 5000) lastPost.clear();
    const entry: LeaderboardEntry = { id: randomUUID().slice(0, 8), name, score, distance, overtakes, at: now };
    entries.push(entry);
    sorted();
    const rank = entries.indexOf(entry) + 1;
    if (entries.length > KEEP) entries.length = KEEP;
    save();
    const body: LeaderboardResponse = { entries: entries.slice(0, SHOW), id: entry.id, rank };
    send(res, 200, body, cors);
  });
  return true;
}
