"use client";

import { ChevronLeft, Download, Flag, Infinity as InfinityIcon, MapPin, MoveHorizontal, Share } from "lucide-react";
import type { ComponentType } from "react";
import { gameActions, useGameState } from "@/hooks/useGameState";
import { audio } from "@/lib/audio";
import { usePwa } from "@/hooks/usePwa";
import { missionActions } from "@/lib/mission/missionStore";
import { raceActions } from "@/lib/race/raceClient";
import { RACE_ENABLED } from "@/lib/race/shared";
import SettingsButtons from "./SettingsButtons";
import { ChampionButton } from "./Leaderboard";

interface ModeCard {
  id: "endless" | "race" | "taxi";
  title: string;
  points: string[];
  Icon: ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>;
  tile: string;
  onPick: () => void;
}

export default function StartScreen() {
  const best = useGameState((s) => s.best);
  const pwa = usePwa();

  const allCards: ModeCard[] = [
    {
      id: "endless",
      title: "اللعب الفردي",
      points: ["سواقة على طول", "فادي العربيات", best > 0 ? `اكسر رقمك (${best})` : "اكسر رقمك"],
      Icon: InfinityIcon,
      tile: "bg-tuk text-saffron",
      onPick: () => gameActions.start(),
    },
    {
      id: "race",
      title: "سباق مع صحابك 🏁",
      points: ["اعمل أوضة خاصة", "ادعي صحابك بالكود", "سباق لايف"],
      Icon: Flag,
      tile: "bg-nile text-cream",
      onPick: () => {
        gameActions.toMenu("race");
        void raceActions.open();
      },
    },
    {
      id: "taxi",
      title: "وصلني يا معلم 🛺",
      points: ["وصّل زباين", "امشي ورا الأسهم", "اكسب نقط"],
      Icon: MapPin,
      tile: "bg-saffron text-ink",
      onPick: () => {
        missionActions.newShift();
        gameActions.enterMode("taxi", "playing");
      },
    },
  ];
  // Online races appear only when a race server is configured (NEXT_PUBLIC_MULTIPLAYER_URL).
  const cards = allCards.filter((c) => c.id !== "race" || RACE_ENABLED);

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" data-ui>
      {/* Header: title painted like a tuk-tuk back panel */}
      <div className="pointer-events-auto relative">
        <div className="bg-tuk border-b-[3px] border-ink px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] shadow-[0_4px_0_#1a0d06]">
          <div className="mx-auto flex max-w-3xl items-start justify-between gap-3">
            <div className="rise-in">
              <h1 className="painted wobble origin-right text-[clamp(2.2rem,8.5vw,4.4rem)] leading-[1.15] text-saffron">
                توكتوك كوبري مصر
              </h1>
              <p className="mt-1 text-[clamp(0.85rem,3.2vw,1.1rem)] font-bold text-cream/95">
                اختار طريقتك.. والكوبري كله يشهدلك 🛺
              </p>
            </div>
            <SettingsButtons compact />
          </div>
        </div>
        <div className="fringe" aria-hidden />
      </div>

      {/* Mode cards */}
      <div className="pointer-events-auto min-h-0 overflow-y-auto px-3 pb-[max(14px,env(safe-area-inset-bottom))] pt-2">
        <div className="plate rise-in mx-auto max-w-md p-3 [animation-delay:120ms] sm:p-4">
          <div className="mb-2.5 flex items-center gap-2 text-[clamp(0.85rem,3.4vw,0.95rem)] font-black leading-snug">
            <MoveHorizontal className="swipe-hint size-5 shrink-0" strokeWidth={2.8} aria-hidden />
            حرّك صباعك يمين وشمال عشان تفادي العربيات
          </div>
          <ul className="space-y-2.5" role="list">
            {cards.map(({ id, title, points, Icon, tile, onPick }) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => {
                    audio.unlock();
                    onPick();
                  }}
                  className="btn-sticker group flex w-full items-center gap-3 bg-white/80 p-2 text-right"
                  autoFocus={id === "endless"}
                  data-mode={id}
                >
                  <span className={`grid size-12 shrink-0 place-items-center rounded-xl border-[2.5px] border-ink ${tile}`}>
                    <Icon className="size-6" strokeWidth={2.8} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="painted-thin block text-[clamp(1.3rem,5.4vw,1.6rem)] leading-[1.35] text-saffron">{title}</span>
                    <span className="block truncate text-[0.78rem] font-bold text-ink/75">{points.join(" • ")}</span>
                  </span>
                  <ChevronLeft className="size-6 shrink-0 text-ink/60 transition-transform group-hover:-translate-x-1" strokeWidth={3} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <ChampionButton />

          {pwa.canInstall && (
            <button
              type="button"
              onClick={() => void pwa.install()}
              className="btn-icon mt-2.5 flex w-full items-center justify-center gap-2 bg-nile py-1.5 text-sm font-black text-cream"
            >
              <Download className="size-4" strokeWidth={2.6} aria-hidden />
              ثبّت اللعبة والعب من غير نت
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
