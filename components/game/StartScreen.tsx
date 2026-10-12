"use client";

import { Download, MoveHorizontal, Share, Trophy } from "lucide-react";
import { gameActions, useGameState } from "@/hooks/useGameState";
import { audio } from "@/lib/audio";
import { usePwa } from "@/hooks/usePwa";
import SettingsButtons from "./SettingsButtons";

export default function StartScreen() {
  const best = useGameState((s) => s.best);
  const pwa = usePwa();

  const play = () => {
    audio.unlock();
    gameActions.start();
  };

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" data-ui>
      {/* Header: title painted like a tuk-tuk back panel */}
      <div className="pointer-events-auto relative">
        <div className="bg-tuk border-b-[3px] border-ink px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] shadow-[0_4px_0_#1a0d06]">
          <div className="mx-auto flex max-w-3xl items-start justify-between gap-3">
            <div className="rise-in">
              <h1 className="painted wobble origin-right text-[clamp(2.4rem,9vw,4.6rem)] leading-[1.15] text-saffron">
                توكتوك كوبري مصر
              </h1>
              <p className="mt-1 text-[clamp(0.9rem,3.4vw,1.15rem)] font-bold text-cream/95">
                عدّي العربيات.. وخلّي الكوبري كله يشهدلك 🛺
              </p>
            </div>
            <SettingsButtons compact />
          </div>
        </div>
        <div className="fringe" aria-hidden />
      </div>

      {/* Footer: instructions + play */}
      <div className="pointer-events-auto px-4 pb-[max(18px,env(safe-area-inset-bottom))]">
        <div className="plate rise-in mx-auto max-w-md p-4 [animation-delay:120ms] sm:p-5">
          <div className="flex items-center gap-3">
            <div className="grid size-12 shrink-0 place-items-center rounded-xl border-[2.5px] border-ink bg-saffron">
              <MoveHorizontal className="swipe-hint size-7" strokeWidth={2.6} aria-hidden />
            </div>
            <p className="text-[clamp(1rem,4vw,1.15rem)] font-black leading-snug">
              حرّك صباعك يمين وشمال عشان تفادي العربيات
            </p>
          </div>
          <p className="mt-2 text-sm font-semibold text-ink/70">
            على الكمبيوتر: الماوس أو الأسهم ← → &nbsp;•&nbsp; المسافة/H للكلاكس &nbsp;•&nbsp; P للإيقاف
          </p>

          <button
            type="button"
            onClick={play}
            className="btn-sticker mt-4 w-full bg-tuk py-3 text-[clamp(1.8rem,7vw,2.3rem)] leading-none text-saffron"
            autoFocus
          >
            <span className="painted-thin">يلا بينا! 🛺</span>
          </button>

          <div className="mt-3 flex items-center justify-center gap-2 text-sm font-bold">
            <Trophy className="size-4 text-tuk" strokeWidth={2.6} aria-hidden />
            <span>أحسن سكور:</span>
            <span className="font-display text-lg leading-none text-tuk tabular-nums">{best}</span>
          </div>

          {pwa.canInstall && (
            <button
              type="button"
              onClick={() => void pwa.install()}
              className="btn-icon mt-3 flex w-full items-center justify-center gap-2 bg-nile py-2 font-black text-cream"
            >
              <Download className="size-5" strokeWidth={2.6} aria-hidden />
              ثبّت اللعبة على موبايلك والعب من غير نت
            </button>
          )}
          {!pwa.canInstall && pwa.showIosHint && (
            <p className="mt-2 flex items-center justify-center gap-1 text-center text-xs font-bold text-ink/70">
              للتثبيت على الآيفون: دوس
              <Share className="size-3.5" strokeWidth={2.6} aria-label="مشاركة" />
              وبعدين «إضافة إلى الشاشة الرئيسية»
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
