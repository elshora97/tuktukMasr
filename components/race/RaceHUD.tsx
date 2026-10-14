"use client";

import { useEffect, useRef } from "react";
import { Coins, Crown, Flag, Flame, Home, Loader2, LogOut, RotateCcw, Timer, Volume2, VolumeX } from "lucide-react";
import { gameActions, useGameState } from "@/hooks/useGameState";
import { useRaceState } from "@/hooks/useRaceState";
import { audio } from "@/lib/audio";
import { raceActions } from "@/lib/race/raceClient";
import { RACE } from "@/lib/race/shared";
import { bindAnchorElement } from "@/lib/screenAnchors";
import { TUKTUK_PAINTS } from "../game/TukTuk";
import { raceLocal } from "./RaceScene";

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
}

/** Position, time, progress markers and countdown — updated on rAF, not React state. */
function LiveRace() {
  const room = useRaceState((s) => s.room)!;
  const myId = useRaceState((s) => s.myId);
  const pos = useRef<HTMLSpanElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const count = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLDivElement>(null);
  const coins = useRef<HTMLSpanElement>(null);
  const nitro = useRef<HTMLDivElement>(null);
  const nitroBox = useRef<HTMLDivElement>(null);
  const nitroBtn = useRef<HTMLButtonElement>(null);
  const markers = useRef<Map<string, HTMLSpanElement>>(new Map());

  useEffect(() => {
    let raf = 0;
    let lastCount = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = raceLocal.t;
      const myD = raceLocal.sim.d;
      // Live order by distance (finished racers keep their order by finish time).
      const all = room.players.map((p) => {
        const d = p.id === myId ? myD : (raceLocal.remotes.get(p.id)?.d ?? 0);
        return { id: p.id, d };
      });
      const sorted = [...all].sort((a, b) => b.d - a.d);
      const place = sorted.findIndex((x) => x.id === myId) + 1;
      if (pos.current) pos.current.textContent = `${place}/${all.length}`;
      if (time.current) time.current.textContent = fmtTime(Math.max(0, raceLocal.sim.finishTime ?? t));
      for (const a of all) {
        const el = markers.current.get(a.id);
        if (el) el.style.right = `${Math.min(100, (a.d / room.distance) * 100).toFixed(2)}%`;
      }
      // Countdown: ٣ ٢ ١ يلا!
      let c = "";
      if (t < 0) c = String(Math.ceil(-t));
      else if (t < 0.9) c = "يلا!";
      if (c !== lastCount && count.current) {
        lastCount = c;
        count.current.textContent = c;
        count.current.style.display = c ? "grid" : "none";
        count.current.classList.remove("score-bump");
        void count.current.offsetWidth;
        count.current.classList.add("score-bump");
      }
      const sim = raceLocal.sim;
      if (coins.current && coins.current.textContent !== String(sim.coins)) {
        coins.current.textContent = String(sim.coins);
        coins.current.classList.remove("score-bump");
        void coins.current.offsetWidth;
        coins.current.classList.add("score-bump");
      }
      // Bar: the stored tank, or what's left of the burn while nitro is on.
      const fill = sim.nitro > 0 ? sim.nitro : sim.tank;
      if (nitro.current) nitro.current.style.width = `${((Math.min(fill, RACE.nitroMaxS) / RACE.nitroMaxS) * 100).toFixed(1)}%`;
      if (nitroBox.current) nitroBox.current.dataset.on = sim.nitro > 0 ? "1" : "0";
      const btn = nitroBtn.current;
      if (btn) {
        const state = sim.nitro > 0 ? "burning" : sim.tank > 0 && sim.stun <= 0 && !sim.finished && t >= 0 ? "ready" : "empty";
        if (btn.dataset.state !== state) btn.dataset.state = state;
        btn.dataset.full = sim.tank >= RACE.nitroMaxS - 0.01 ? "1" : "0";
      }
      if (done.current) done.current.style.display = raceLocal.sim.finished ? "flex" : "none";
    };
    raf = requestAnimationFrame(tick);
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || (e.target as HTMLElement | null)?.closest?.("input, textarea")) return;
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        e.preventDefault();
        raceLocal.nitroPressed = true;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
  }, [room, myId]);

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border-[2.5px] border-ink bg-tuk px-2.5 py-0.5 shadow-[0_3px_0_#1a0d06]">
          <span className="text-xs font-black text-cream">المركز</span>
          <span ref={pos} className="painted-thin text-2xl leading-[1.3] text-saffron tabular-nums" dir="ltr">
            1/1
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-xl border-2 border-ink bg-cream px-2 py-1 text-sm font-black tabular-nums">
          <Timer className="size-4" strokeWidth={2.8} aria-hidden />
          <span ref={time} dir="ltr">
            0:00.0
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-xl border-2 border-ink bg-saffron px-2 py-1 text-sm font-black tabular-nums" aria-label="الفلوس">
          <Coins className="size-4" strokeWidth={2.8} aria-hidden />
          <span ref={coins} className="inline-block" dir="ltr">
            0
          </span>
        </div>
      </div>
      {/* Progress track: start on the right, finish flag on the left (RTL) */}
      <div className="relative mt-2 h-3 rounded-full border-2 border-ink bg-white/80">
        <Flag className="absolute -left-1 -top-4 size-4 text-ink" strokeWidth={2.8} aria-hidden />
        {room.players.map((p) => (
          <span
            key={p.id}
            ref={(el) => {
              if (el) markers.current.set(p.id, el);
              else markers.current.delete(p.id);
            }}
            className={`absolute top-1/2 -translate-y-1/2 translate-x-1/2 rounded-full border-2 border-ink ${p.id === myId ? "z-10 size-4" : "size-3"}`}
            style={{ right: "0%", background: TUKTUK_PAINTS[p.paint % TUKTUK_PAINTS.length].main }}
            title={p.name}
          />
        ))}
      </div>
      {/* Nitro: filled by coins */}
      <div
        ref={nitroBox}
        data-on="0"
        className="mt-1.5 flex items-center gap-1.5 rounded-full border-2 border-ink bg-cream px-2 py-0.5 text-xs font-black data-[on=1]:bg-ink data-[on=1]:text-saffron"
        aria-label="نيترو"
      >
        <Flame className="size-3.5 shrink-0" strokeWidth={2.8} aria-hidden />
        <span>نيترو</span>
        <div className="relative h-2 flex-1 overflow-hidden rounded-full border-[1.5px] border-current bg-white/60">
          <div ref={nitro} className="absolute inset-y-0 right-0 bg-gradient-to-l from-saffron via-orange-500 to-red-500" style={{ width: "0%" }} />
        </div>
      </div>
      {/* Nitro button (bottom-left, away from the steering thumb's usual spot) */}
      <button
        ref={nitroBtn}
        type="button"
        data-ui
        data-state="empty"
        aria-label="نيترو"
        onPointerDown={(e) => {
          e.preventDefault();
          raceLocal.nitroPressed = true;
        }}
        className="nitro-btn pointer-events-auto fixed bottom-[max(18px,env(safe-area-inset-bottom))] left-4 grid size-20 touch-none select-none place-items-center rounded-full border-[3px] border-ink bg-cream text-ink shadow-[0_5px_0_#1a0d06] transition-transform active:translate-y-1 active:shadow-[0_2px_0_#1a0d06] data-[state=empty]:opacity-55 data-[state=ready]:bg-saffron data-[state=burning]:bg-[#ff5a00] data-[state=burning]:text-cream"
      >
        <span className="flex flex-col items-center leading-none">
          <Flame className="size-8" strokeWidth={2.6} aria-hidden />
          <span className="mt-0.5 text-[0.7rem] font-black">نيترو</span>
        </span>
      </button>
      <div
        ref={count}
        className="painted pointer-events-none fixed inset-0 hidden place-items-center text-[clamp(5rem,28vw,10rem)] leading-none text-saffron"
        aria-live="assertive"
      />
      <div
        ref={done}
        className="pointer-events-none fixed inset-x-0 top-[calc(max(10px,env(safe-area-inset-top))+120px)] hidden justify-center"
      >
        <div className="rise-in rounded-2xl border-[2.5px] border-ink bg-saffron px-4 py-1.5 font-black shadow-[0_4px_0_#1a0d06]">وصلت! 🏁 استنى الباقيين..</div>
      </div>
    </>
  );
}

/** Small name pills pinned above the other racers' tuk-tuks. */
function NameTags() {
  const room = useRaceState((s) => s.room)!;
  const myId = useRaceState((s) => s.myId);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {room.players
        .filter((p) => p.id !== myId)
        .map((p) => (
          <div key={p.id} ref={(el) => bindAnchorElement("tag-" + p.id, el)} className="absolute left-0 top-0 will-change-transform">
            <span
              className="block whitespace-nowrap rounded-full border-2 border-ink px-2 py-px text-[0.72rem] font-black text-cream shadow-[0_2px_0_#1a0d06]"
              style={{ background: TUKTUK_PAINTS[p.paint % TUKTUK_PAINTS.length].main }}
            >
              {p.name}
              {!p.connected && " 📵"}
            </span>
          </div>
        ))}
    </div>
  );
}

function Results() {
  const room = useRaceState((s) => s.room)!;
  const myId = useRaceState((s) => s.myId);
  const results = room.results ?? [];
  const isHost = room.hostId === myId;
  const mine = results.find((r) => r.id === myId);
  const winner = results[0];
  useEffect(() => {
    if (mine?.place === 1) audio.fanfare();
  }, [mine?.place]);
  return (
    <div className="absolute inset-0 grid place-items-center overflow-y-auto bg-ink/50 p-4 backdrop-blur-[3px]" data-ui>
      <div className="plate rise-in w-full max-w-sm overflow-hidden" role="dialog" aria-modal aria-labelledby="race-results-title">
        <div className="border-b-[3px] border-ink bg-tuk px-4 pb-3 pt-4 text-center">
          <h2 id="race-results-title" className="painted text-[clamp(1.8rem,7.5vw,2.4rem)] leading-[1.3] text-saffron">
            {mine?.place === 1 ? "كسبت السباق يا وحش! 🏆" : winner ? `${winner.name} كسب السباق!` : "خلص السباق"}
          </h2>
        </div>
        <div className="fringe" aria-hidden />
        <div className="px-4 pb-4 pt-2">
          <ol className="space-y-1.5" data-testid="results">
            {results.map((r) => (
              <li
                key={r.id}
                className={`flex items-center gap-2 rounded-xl border-2 px-2.5 py-1.5 ${r.id === myId ? "border-ink bg-saffron/60" : "border-ink/60 bg-white/80"}`}
              >
                <span className="painted-thin w-7 text-center text-2xl leading-none text-saffron tabular-nums">{r.place}</span>
                {r.place === 1 && <Crown className="size-4 text-tuk" strokeWidth={2.8} aria-label="الكسبان" />}
                <span className="min-w-0 flex-1 truncate font-black">
                  {r.name}
                  {r.left && <span className="mr-1 text-xs text-ink/60">(خرج)</span>}
                </span>
                <span className="text-sm font-black tabular-nums" dir="ltr">
                  {r.finished && r.time !== null ? fmtTime(r.time) : `${r.distance} m`}
                </span>
                {!r.finished && <span className="text-xs font-bold text-ink/60">مكمّلش</span>}
              </li>
            ))}
          </ol>
          {mine && (
            <p className="mt-2 text-center text-xs font-bold text-ink/70">
              خبطت {mine.hits} {mine.hits === 1 ? "مرة" : "مرات"} في السكة · لمّيت {mine.coins ?? 0} 🪙
            </p>
          )}
          {isHost ? (
            <button
              type="button"
              autoFocus
              onClick={() => raceActions.raceAgain()}
              className="btn-sticker mt-4 flex w-full items-center justify-center gap-2 bg-tuk py-3 text-2xl text-saffron"
            >
              <RotateCcw className="size-6 stroke-saffron" strokeWidth={3} aria-hidden />
              <span className="painted-thin">سباق تاني (للوبي)</span>
            </button>
          ) : (
            <p className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-ink/10 py-2 text-sm font-black">
              <Loader2 className="size-4 animate-spin" aria-hidden /> مستنيين صاحب الأوضة يبدأ سباق تاني
            </p>
          )}
          <button type="button" onClick={() => raceActions.leave()} className="btn-sticker mt-3 flex w-full items-center justify-center gap-2 bg-cream py-2.5 text-xl">
            <LogOut className="size-5" strokeWidth={2.6} aria-hidden />
            اخرج من الأوضة
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RaceHUD() {
  const room = useRaceState((s) => s.room);
  const connection = useRaceState((s) => s.connection);
  const sound = useGameState((s) => s.sound);
  if (!room) return null;
  return (
    <div className="pointer-events-none absolute inset-0">
      <NameTags />
      <div className="flex items-start gap-2 px-3 pt-[max(10px,env(safe-area-inset-top))]">
        <div className="pointer-events-auto flex flex-col gap-2" data-ui>
          <button
            type="button"
            aria-label="اخرج من السباق"
            onClick={() => {
              raceActions.leave();
              gameActions.toMenu("race");
            }}
            className="btn-icon grid size-11 place-items-center bg-cream"
          >
            <Home className="size-6" strokeWidth={2.6} aria-hidden />
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
        <div className="min-w-0 flex-1 rounded-2xl border-[2.5px] border-ink bg-cream/95 px-3 pb-3 pt-2 shadow-[0_4px_0_#1a0d06]">
          <LiveRace />
        </div>
      </div>
      {connection === "reconnecting" && (
        <div className="absolute inset-x-0 top-[calc(max(10px,env(safe-area-inset-top))+96px)] flex justify-center">
          <div className="flex items-center gap-2 rounded-full bg-ink/85 px-3 py-1 text-sm font-bold text-cream">
            <Loader2 className="size-4 animate-spin" aria-hidden /> النت قطع.. بنحاول نرجّعك
          </div>
        </div>
      )}
      {room.phase === "results" && (
        <div className="pointer-events-auto">
          <Results />
        </div>
      )}
    </div>
  );
}
