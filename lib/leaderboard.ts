import type { LeaderboardEntry, LeaderboardResponse } from "./leaderboardTypes";
import { sanitizeName } from "./race/shared";
import { serverUrl } from "./race/raceClient";

/**
 * High scores for the endless mode. Uses the race server's shared board when
 * it's reachable; otherwise falls back to a board kept on this device, so
 * saving a record always works.
 */
export interface Board {
  entries: LeaderboardEntry[];
  /** true = shared online board, false = this device only. */
  global: boolean;
  id?: string;
  rank?: number;
}

const LOCAL_KEY = "toktok-kobry:local-board";
const NAME_KEY = "toktok-kobry:racer-name";
const TIMEOUT_MS = 5000;

export function savedName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function readLocal(): LeaderboardEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function request(init?: RequestInit): Promise<LeaderboardResponse | null> {
  const base = serverUrl();
  if (!base) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/leaderboard`, { ...init, signal: ctl.signal });
    if (!res.ok) return null;
    return (await res.json()) as LeaderboardResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBoard(): Promise<Board> {
  const online = await request();
  if (online) return { entries: online.entries, global: true };
  return { entries: readLocal().slice(0, 20), global: false };
}

export async function submitScore(rawName: string, score: number, distance: number, overtakes: number): Promise<Board> {
  const name = sanitizeName(rawName);
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
  const body = { name, score: Math.round(score), distance: Math.round(distance), overtakes };
  const online = await request({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (online) return { entries: online.entries, global: true, id: online.id, rank: online.rank };
  // Offline / no server: keep it on this device.
  const entry: LeaderboardEntry = { id: Math.random().toString(36).slice(2, 10), ...body, at: Date.now() };
  const list = [...readLocal(), entry].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, 50);
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  const rank = list.findIndex((e) => e.id === entry.id) + 1;
  return { entries: list.slice(0, 20), global: false, id: entry.id, rank: rank || undefined };
}
