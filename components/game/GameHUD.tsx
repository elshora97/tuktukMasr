"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Home, Megaphone, MoveHorizontal, Pause, Play, Trophy, Volume2, VolumeX } from "lucide-react";
import { gameActions, useGameState } from "@/hooks/useGameState";
import { runtime } from "@/lib/gameStore";
import { audio } from "@/lib/audio";
import SettingsButtons from "./SettingsButtons";

export function formatDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} كم` : `${Math.floor(m)} م`;
}

/** Distance/speed readout updated from the runtime on its own rAF — no React renders. */
function LiveStats() {
  const dist = useRef<HTMLSpanElement>(null);
  const speed = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = "";
    const tick = () => {
      const d = formatDistance(runtime.distance);
      const s = `${Math.round(runtime.speed * 3.6)}`;
      const key = d + s;
      if (key !== last) {
        last = key;
        if (dist.current) dist.current.textContent = d;
        if (speed.current) speed.current.textContent = s;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="flex items-center gap-1.5 text-[0.8rem] font-bold leading-none text-cream">
      <span ref={dist} className="tabular-nums">0 م</span>
      <span className="opacity-60">•</span>
      <span ref={speed} className="tabular-nums" dir="ltr">0</span>
      <span>كم/س</span>
    </div>
  );
}

function ScoreBoard() {
  const score = useGameState((s) => s.score);
  const best = useGameState((s) => s.best);
  const beating = score > best && best > 0;
  return (
    <div className="flex flex-col items-center">
      <div className="relative rounded-2xl border-[3px] border-ink bg-tuk px-5 pb-1 pt-0.5 shadow-[0_5px_0_#1a0d06]">
        <span key={score} className="score-bump painted block text-center text-[clamp(2rem,8vw,2.8rem)] leading-[1.25] text-saffron tabular-nums">
          {score}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1 rounded-full border-2 border-ink bg-cream px-2.5 py-0.5 text-xs font-black">
        <Trophy className={`size-3.5 ${beating ? "text-tuk" : ""}`} strokeWidth={2.8} aria-hidden />
        {beating ? <span className="text-tuk">رقم قياسي!</span> : <span className="tabular-nums">{best}</span>}
      </div>
    </div>
  );
}

/** Optional on-screen steering pads (accessibility / desktop touchscreens). */
function SteerPads() {
  const set = (v: number) => () => {
    runtime.padSteer = v;
  };
  const pad =
    "btn-icon pointer-events-auto grid size-[4.5rem] place-items-center bg-cream/85 backdrop-blur-sm active:bg-saffron";
  return (
    <div dir="ltr" className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between px-4 pb-[max(16px,env(safe-area-inset-bottom))]" data-ui>
      {[
        { v: -1, Icon: ChevronLeft, label: "شمال" },
        { v: 1, Icon: ChevronRight, label: "يمين" },
      ].map(({ v, Icon, label }) => (
        <button
          key={v}
          type="button"
          aria-label={label}
          className={pad}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            set(v)();
          }}
          onPointerUp={set(0)}
          onPointerCancel={set(0)}
          onLostPointerCapture={set(0)}
        >
          <Icon className="size-9" strokeWidth={3} aria-hidden />
        </button>
      ))}
    </div>
  );
}

function SwipeHint() {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShow(false), 3200);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[22%] flex justify-center" aria-hidden>
      <div className="rise-in flex items-center gap-2 rounded-full border-[2.5px] border-ink bg-cream/90 px-4 py-2 font-black shadow-[0_4px_0_#1a0d06]">
        <MoveHorizontal className="swipe-hint size-6" strokeWidth={2.8} />
        اسحب يمين وشمال
      </div>
    </div>
  );
}

function PauseOverlay() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-ink/45 p-4 backdrop-blur-[2px]" data-ui>
      <div className="plate rise-in w-full max-w-sm overflow-hidden p-0" role="dialog" aria-modal aria-label="اللعبة واقفة">
        <div className="bg-nile border-b-[3px] border-ink px-5 py-3 text-center">
          <h2 className="painted text-4xl leading-[1.3] text-cream">استراحة شاي ☕</h2>
        </div>
        <div className="space-y-3 p-5">
          <button type="button" autoFocus onClick={() => gameActions.resume()} className="btn-sticker flex w-full items-center justify-center gap-2 bg-tuk py-3 text-3xl text-saffron">
            <Play className="size-7 fill-saffron stroke-ink" strokeWidth={2} aria-hidden />
            <span className="painted-thin">كمّل يا أسطى</span>
          </button>
          <button type="button" onClick={() => gameActions.toMenu()} className="btn-sticker flex w-full items-center justify-center gap-2 bg-cream py-2.5 text-2xl">
            <Home className="size-6" strokeWidth={2.6} aria-hidden />
            القائمة الرئيسية
          </button>
          <SettingsButtons />
        </div>
      </div>
    </div>
  );
}

export default function GameHUD() {
  const status = useGameState((s) => s.status);
  const sound = useGameState((s) => s.sound);
  const showPads = useGameState((s) => s.showPads);
  const runId = useGameState((s) => s.runId);
  const active = status === "playing" || status === "paused";

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Top bar */}
      <div className="flex items-start justify-between gap-2 px-3 pt-[max(10px,env(safe-area-inset-top))]">
        <div className="pointer-events-auto flex flex-col gap-2" data-ui>
          <button
            type="button"
            aria-label={status === "paused" ? "كمّل" : "وقف اللعبة"}
            onClick={() => gameActions.togglePause()}
            disabled={!active}
            className="btn-icon grid size-11 place-items-center bg-cream"
          >
            {status === "paused" ? <Play className="size-6" strokeWidth={2.6} aria-hidden /> : <Pause className="size-6" strokeWidth={2.6} aria-hidden />}
          </button>
          <button
            type="button"
            aria-label={sound ? "اقفل الصوت" : "شغّل الصوت"}
            aria-pressed={sound}
            onClick={() => {
              audio.unlock();
              gameActions.setSound(!sound);
            }}
            className="btn-icon grid size-11 place-items-center bg-cream"
          >
            {sound ? <Volume2 className="size-6" strokeWidth={2.6} aria-hidden /> : <VolumeX className="size-6" strokeWidth={2.6} aria-hidden />}
          </button>
        </div>

        <ScoreBoard />

        <div className="flex flex-col items-end gap-2">
          <div className="rounded-xl border-2 border-ink bg-ink/80 px-2.5 py-1.5">
            <LiveStats />
          </div>
          <button
            type="button"
            aria-label="كلاكس"
            data-ui
            onPointerDown={(e) => {
              e.stopPropagation();
              audio.unlock();
              gameActions.horn();
            }}
            disabled={status !== "playing"}
            className="btn-icon pointer-events-auto flex h-11 items-center gap-1 bg-saffron px-2.5 font-display text-lg"
          >
            <Megaphone className="size-5 -scale-x-100" strokeWidth={2.6} aria-hidden />
            بيب!
          </button>
        </div>
      </div>

      {status === "playing" && <SwipeHint key={runId} />}
      {showPads && status === "playing" && <SteerPads />}
      {status === "paused" && (
        <div className="pointer-events-auto">
          <PauseOverlay />
        </div>
      )}
    </div>
  );
}
