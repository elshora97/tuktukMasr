"use client";

import { useEffect, useState } from "react";
import { Loader2, Medal } from "lucide-react";
import { RACE } from "@/lib/race/shared";
import { fetchBoard, savedName, submitScore, type Board } from "@/lib/leaderboard";
import { BoardList, BoardScope, MEDALS } from "./Leaderboard";

/**
 * After a crash: write your name to save the run on the high-score board
 * («أبطال الكوبري»), then see where it landed among everyone's records.
 */
export default function RecordPanel({ score, distance, overtakes }: { score: number; distance: number; overtakes: number }) {
  const [name, setName] = useState(savedName);
  const [board, setBoard] = useState<Board | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetchBoard().then((b) => live && setBoard((cur) => cur ?? b));
    return () => {
      live = false;
    };
  }, []);

  const canSave = score > 0 && state === "idle";
  const save = async () => {
    if (!name.trim()) return setError("اكتب اسمك الأول يا كابتن");
    setError("");
    setState("saving");
    const b = await submitScore(name, score, distance, overtakes);
    setBoard(b);
    setState("saved");
  };

  const mineId = state === "saved" ? board?.id : undefined;

  return (
    <section className="mt-3 rounded-2xl border-[2.5px] border-ink bg-white/70 p-2.5" aria-labelledby="board-title">
      {canSave && (
        <form
          className="mb-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label htmlFor="record-name" className="mb-1 block text-sm font-black">
            سجّل رقمك باسمك 🏁
          </label>
          <div className="flex gap-2">
            <input
              id="record-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={RACE.nameMax}
              autoComplete="nickname"
              enterKeyHint="done"
              placeholder="اسمك إيه؟"
              className="min-w-0 flex-1 rounded-xl border-[2.5px] border-ink bg-white px-3 py-2 text-base font-bold outline-none focus:border-nile"
            />
            <button type="submit" className="btn-sticker shrink-0 bg-saffron px-3 py-2 text-base font-black">
              سجّل
            </button>
          </div>
          {error && (
            <p className="mt-1 text-xs font-bold text-tuk" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
      {state === "saving" && (
        <p className="mb-2 flex items-center justify-center gap-1 text-sm font-bold">
          <Loader2 className="size-4 animate-spin" aria-hidden /> بنسجّل رقمك..
        </p>
      )}
      {state === "saved" && board?.rank && (
        <p className="mb-2 text-center text-sm font-black" role="status">
          اتسجّلت! مركزك <span className="painted-thin text-xl text-tuk tabular-nums" dir="ltr">#{board.rank}</span> {board.rank <= 3 ? MEDALS[board.rank - 1] : "👏"}
        </p>
      )}

      <h3 id="board-title" className="mb-1 flex items-center gap-1.5 text-sm font-black">
        <Medal className="size-4 text-tuk" strokeWidth={2.6} aria-hidden />
        أبطال الكوبري
        <span className="mr-auto">
          <BoardScope board={board} />
        </span>
      </h3>
      <div className="max-h-44 overflow-y-auto">
        <BoardList board={board} mineId={mineId} mine={mineId && board?.rank ? { rank: board.rank, name, score } : undefined} />
      </div>
    </section>
  );
}
