"use client";

import { useState } from "react";
import { Home, Trophy } from "lucide-react";
import { gameActions, useGameState } from "@/hooks/useGameState";
import { runtime } from "@/lib/gameStore";
import { audio } from "@/lib/audio";
import { formatDistance } from "./GameHUD";
import RecordPanel from "./RecordPanel";

export default function GameOverScreen() {
  const score = useGameState((s) => s.score);
  const best = useGameState((s) => s.best);
  const isNewBest = useGameState((s) => s.isNewBest);
  const overtakes = useGameState((s) => s.overtakes);
  const closeCalls = useGameState((s) => s.closeCalls);
  const message = useGameState((s) => s.gameOverMessage);
  // Snapshot taken when the overlay mounts (after the crash), not live.
  const [meters] = useState(() => Math.round(runtime.distance));
  const distance = formatDistance(meters);

  return (
    <div className="absolute inset-0 grid place-items-center overflow-y-auto bg-ink/50 p-4 backdrop-blur-[3px]" data-ui>
      <div className="plate rise-in w-full max-w-sm overflow-hidden" role="dialog" aria-modal aria-labelledby="go-title">
        <div className="relative border-b-[3px] border-ink bg-tuk px-4 pb-3 pt-4 text-center">
          <h2 id="go-title" className="painted text-[clamp(2rem,8vw,2.6rem)] leading-[1.3] text-saffron">
            {message}
          </h2>
        </div>
        <div className="fringe" aria-hidden />

        <div className="px-5 pb-5 pt-2">
          {isNewBest && (
            <div className="wobble mx-auto mb-2 w-fit rounded-full border-[2.5px] border-ink bg-saffron px-4 py-1 text-lg font-black shadow-[0_3px_0_#1a0d06]">
              رقم قياسي جديد! 🏆
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-2xl border-[2.5px] border-ink bg-white/70 p-2">
              <div className="text-sm font-bold text-ink/70">السكور</div>
              <div className="painted-thin text-5xl leading-[1.3] text-saffron tabular-nums">{score}</div>
            </div>
            <div className="rounded-2xl border-[2.5px] border-ink bg-white/70 p-2">
              <div className="flex items-center justify-center gap-1 text-sm font-bold text-ink/70">
                <Trophy className="size-4" strokeWidth={2.6} aria-hidden />
                أحسن سكور
              </div>
              <div className="painted-thin text-5xl leading-[1.3] text-nile tabular-nums">{best}</div>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-bold">
            <div className="rounded-xl bg-sand/60 px-1 py-1.5">
              <dt className="text-ink/70">عدّيت</dt>
              <dd className="text-base font-black tabular-nums">{overtakes} عربية</dd>
            </div>
            <div className="rounded-xl bg-sand/60 px-1 py-1.5">
              <dt className="text-ink/70">على الشعرة</dt>
              <dd className="text-base font-black tabular-nums">{closeCalls}</dd>
            </div>
            <div className="rounded-xl bg-sand/60 px-1 py-1.5">
              <dt className="text-ink/70">المسافة</dt>
              <dd className="text-base font-black tabular-nums">{distance}</dd>
            </div>
          </dl>
          <RecordPanel score={score} distance={meters} overtakes={overtakes} />

          <button
            type="button"
            autoFocus
            onClick={() => {
              audio.unlock();
              gameActions.start();
            }}
            className="btn-sticker mt-4 flex w-full items-center justify-center gap-2 bg-tuk py-3 text-3xl text-saffron"
          >
            <span className="painted-thin">العب تاني 🔄</span>
          </button>
          <button
            type="button"
            onClick={() => gameActions.toMenu()}
            className="btn-sticker mt-3 flex w-full items-center justify-center gap-2 bg-cream py-2.5 text-2xl"
          >
            <Home className="size-6" strokeWidth={2.6} aria-hidden />
            القائمة الرئيسية
          </button>
        </div>
      </div>
    </div>
  );
}
