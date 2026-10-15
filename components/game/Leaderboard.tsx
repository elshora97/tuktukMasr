"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Globe, Loader2, Medal, RotateCw, Smartphone, Trophy, X } from "lucide-react";
import { fetchBoard, type Board } from "@/lib/leaderboard";

export const MEDALS = ["🥇", "🥈", "🥉"];

/** Ranked list of records; `mineId` is highlighted. */
export function BoardList({ board, limit = 10, mineId, mine }: { board: Board | null; limit?: number; mineId?: string; mine?: { rank: number; name: string; score: number } }) {
  if (!board)
    return (
      <p className="flex items-center justify-center gap-1 py-2 text-xs font-bold text-ink/60">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> بنجيب الأرقام..
      </p>
    );
  const top = board.entries.slice(0, limit);
  if (top.length === 0) return <p className="py-2 text-center text-xs font-bold text-ink/60">لسه مفيش أرقام.. كن أول بطل!</p>;
  const mineOutside = mine && mineId && !top.some((e) => e.id === mineId);
  return (
    <ol className="space-y-0.5 text-sm">
      {top.map((e, i) => (
        <li key={e.id} className={`flex items-center gap-2 rounded-lg px-2 py-1 ${e.id === mineId ? "bg-saffron font-black" : i % 2 ? "" : "bg-sand/40"}`}>
          <span className="w-7 text-center tabular-nums">{MEDALS[i] ?? i + 1}</span>
          <span className="min-w-0 flex-1 truncate font-bold">{e.name}</span>
          <span className="text-xs font-bold text-ink/55 tabular-nums" dir="ltr">
            {e.distance >= 1000 ? `${(e.distance / 1000).toFixed(1)} km` : `${e.distance} m`}
          </span>
          <span className="w-12 text-left font-black tabular-nums">{e.score}</span>
        </li>
      ))}
      {mineOutside && (
        <li className="flex items-center gap-2 rounded-lg bg-saffron px-2 py-1 font-black">
          <span className="w-7 text-center tabular-nums">{mine.rank}</span>
          <span className="min-w-0 flex-1 truncate">{mine.name}</span>
          <span className="w-12 text-left tabular-nums">{mine.score}</span>
        </li>
      )}
    </ol>
  );
}

export function BoardScope({ board }: { board: Board | null }) {
  if (!board) return null;
  return (
    <span className="flex items-center gap-1 text-[0.7rem] font-bold text-ink/60">
      {board.global ? <Globe className="size-3.5" aria-hidden /> : <Smartphone className="size-3.5" aria-hidden />}
      {board.global ? "كل اللعيبة" : "على الجهاز ده بس"}
    </span>
  );
}

/** Main-menu entry: shows the current champion, opens the full board. */
export function ChampionButton() {
  const [board, setBoard] = useState<Board | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    fetchBoard().then((b) => live && setBoard(b));
    return () => {
      live = false;
    };
  }, [open]);
  const champ = board?.entries[0];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-sticker mt-2.5 flex w-full items-center gap-3 bg-saffron p-2 text-right"
        data-testid="open-leaderboard"
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-xl border-[2.5px] border-ink bg-ink text-saffron">
          <Trophy className="size-6" strokeWidth={2.8} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="painted-thin block text-[clamp(1.3rem,5.4vw,1.6rem)] leading-[1.35] text-tuk">أبطال الكوبري 🏆</span>
          <span className="block truncate text-[0.78rem] font-bold text-ink/80">
            {champ ? `البطل: ${champ.name} — ${champ.score}` : "مين أعلى سكور في اللعب الفردي؟"}
          </span>
        </span>
      </button>
      {/* Portal: the menu card animates with a transform, which would trap a fixed overlay. */}
      {open && createPortal(<LeaderboardSheet initial={board} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

/** Full-screen top-20 board. */
export function LeaderboardSheet({ initial, onClose }: { initial: Board | null; onClose: () => void }) {
  const [board, setBoard] = useState<Board | null>(initial);
  const [loading, setLoading] = useState(false);
  const refresh = () => {
    setLoading(true);
    fetchBoard().then((b) => {
      setBoard(b);
      setLoading(false);
    });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="pointer-events-auto fixed inset-0 z-20 grid place-items-center bg-ink/50 p-4 backdrop-blur-[3px]" data-ui onClick={onClose}>
      <div
        className="plate rise-in flex max-h-[85dvh] w-full max-w-sm flex-col overflow-hidden"
        role="dialog"
        aria-modal
        aria-labelledby="lb-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative border-b-[3px] border-ink bg-tuk px-4 pb-3 pt-4 text-center">
          <h2 id="lb-title" className="painted flex items-center justify-center gap-2 text-[clamp(1.8rem,7.5vw,2.4rem)] leading-[1.3] text-saffron">
            <Medal className="size-8" strokeWidth={2.6} aria-hidden />
            أبطال الكوبري
          </h2>
          <p className="text-xs font-bold text-cream/90">أعلى سكور في اللعب الفردي</p>
          <button type="button" onClick={onClose} aria-label="اقفل" className="btn-icon absolute left-3 top-3 grid size-9 place-items-center bg-cream" autoFocus>
            <X className="size-5" strokeWidth={2.8} aria-hidden />
          </button>
        </div>
        <div className="fringe" aria-hidden />
        <div className="flex items-center justify-between px-4 pt-2">
          <BoardScope board={board} />
          <button type="button" onClick={refresh} className="flex items-center gap-1 text-xs font-black text-ink/70" aria-label="حدّث">
            <RotateCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={2.8} aria-hidden />
            حدّث
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-3 pb-4 pt-1">
          <BoardList board={board} limit={20} />
        </div>
      </div>
    </div>
  );
}
