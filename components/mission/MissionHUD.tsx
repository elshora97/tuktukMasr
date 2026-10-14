"use client";

import { useEffect, useRef } from "react";
import { ArrowUp, Heart, Home, MapPin, Pause, Play, RotateCcw, Signpost, Timer, Trophy, Volume2, VolumeX } from "lucide-react";
import { gameActions, useGameState } from "@/hooks/useGameState";
import { useMissionState } from "@/hooks/useMissionState";
import { runtime } from "@/lib/gameStore";
import { audio } from "@/lib/audio";
import { MISSION, MISSION_TEXT } from "@/lib/mission/missionConfig";
import { mission, missionActions, missionStore, type MissionPhase } from "@/lib/mission/missionStore";
import { nextTurn, routeToWorld, streetAt, type RoutePoint } from "@/lib/mission/route";
import { PASSENGERS } from "@/lib/passengerModels";

const wp: RoutePoint = { x: 0, z: 0, h: 0 };
const toPassenger = (p: MissionPhase) => p === "missionStart" || p === "approachingPassenger" || p === "pickupAvailable";

function fmtDist(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} كم` : `${Math.max(0, Math.round(m / 10) * 10)} م`;
}

/**
 * Live navigation readouts, written straight to the DOM on rAF (no React
 * re-renders per frame): distance to goal, time left, the maneuver hint and a
 * bearing arrow that points at a real waypoint 45 m ahead on the route.
 */
function NavLive() {
  const dist = useRef<HTMLSpanElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const timeBox = useRef<HTMLDivElement>(null);
  const arrow = useRef<SVGSVGElement>(null);
  const hint = useRef<HTMLSpanElement>(null);
  const street = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let lastHint = "";
    let lastStreet = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const route = mission.route;
      if (!route) return;
      const { phase, timeLimit } = missionStore.getState();
      const goal = toPassenger(phase) ? route.passengerS : route.dropS;
      if (dist.current) dist.current.textContent = fmtDist(goal - mission.s);
      const left = Math.max(0, timeLimit - mission.time);
      if (time.current) time.current.textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}`;
      timeBox.current?.classList.toggle("bg-tuk", left < 15);
      timeBox.current?.classList.toggle("text-cream", left < 15);
      // Bearing to a waypoint ahead on the route, relative to the tuk-tuk heading.
      const pose = runtime.pose;
      routeToWorld(route, Math.min(goal, mission.s + 45), toPassenger(phase) ? 4 : 0, wp);
      const vx = wp.x - pose.x;
      const vz = wp.z - pose.z;
      const fwd = -vx * Math.sin(pose.heading) - vz * Math.cos(pose.heading);
      const right = vx * Math.cos(pose.heading) - vz * Math.sin(pose.heading);
      const ang = Math.atan2(right, fwd);
      if (arrow.current) arrow.current.style.transform = `rotate(${ang.toFixed(3)}rad)`;
      // Maneuver hint.
      let h: string;
      const turn = nextTurn(route, mission.s);
      const toGoal = goal - mission.s;
      if (toGoal < 120) h = toPassenger(phase) ? "قرّب من الرصيف اليمين" : "ادخل يمين.. المكان المنوّر";
      else if (turn && turn.start - mission.s < 260 && turn.start < goal) {
        const where = turn.start - mission.s;
        const side = turn.dir === "right" ? "يمين" : "شمال";
        h = where <= 15 ? `لف ${side} دلوقتي` : `لف ${side} بعد ${fmtDist(where)}`;
      } else h = "على طول";
      if (h !== lastHint && hint.current) {
        lastHint = h;
        hint.current.textContent = h;
      }
      const st = streetAt(route, mission.s);
      const sn = st ? (st.bridge ? `${st.name} 🌉` : st.name) : "";
      if (sn !== lastStreet && street.current) {
        lastStreet = sn;
        street.current.textContent = sn;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-full border-[2.5px] border-ink bg-saffron">
          <ArrowUp ref={arrow} className="size-5 transition-transform duration-150" strokeWidth={3.2} aria-hidden />
        </span>
        <span ref={hint} className="text-sm font-black leading-tight" aria-live="polite">
          على طول
        </span>
        <span className="mr-auto rounded-full bg-ink/85 px-2 py-0.5 text-xs font-black text-cream tabular-nums" ref={dist}>
          —
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1 text-xs font-bold text-ink/70">
        <Signpost className="size-3.5 shrink-0" strokeWidth={2.6} aria-hidden />
        <span ref={street} className="truncate" />
      </div>
      <div ref={timeBox} className="absolute -bottom-3 left-3 flex items-center gap-1 rounded-full border-2 border-ink bg-cream px-2 py-0.5 text-xs font-black tabular-nums shadow-[0_2px_0_#1a0d06]">
        <Timer className="size-3.5" strokeWidth={2.8} aria-hidden />
        <span ref={time} dir="ltr">
          0:00
        </span>
      </div>
    </>
  );
}

/** Stop-and-hold prompt with a progress bar (pickup / drop-off). */
function ZonePrompt({ text }: { text: string }) {
  const bar = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const k = Math.min(1, mission.holdT / MISSION.holdS);
      if (bar.current) bar.current.style.transform = `scaleX(${k})`;
      if (label.current) label.current.textContent = k > 0 ? MISSION_TEXT.holdPrompt : text;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);
  return (
    <div className="rise-in pointer-events-none absolute inset-x-0 bottom-[max(118px,calc(env(safe-area-inset-bottom)+110px))] flex justify-center px-4">
      <div className="w-full max-w-xs overflow-hidden rounded-2xl border-[2.5px] border-ink bg-cream shadow-[0_4px_0_#1a0d06]">
        <div className="px-3 py-1.5 text-center text-sm font-black">
          <span ref={label}>{text}</span>
          <span className="mx-1 text-ink/60">— دوس فرامل</span>
        </div>
        <div className="h-1.5 bg-ink/15">
          <div ref={bar} className="h-full origin-right scale-x-0 bg-nile" />
        </div>
      </div>
    </div>
  );
}

function BrakePedal() {
  const set = (v: boolean) => () => {
    runtime.brake = v;
  };
  return (
    <div dir="ltr" className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-end px-4 pb-[max(16px,env(safe-area-inset-bottom))]" data-ui>
      <button
        type="button"
        aria-label="فرامل"
        className="btn-icon pointer-events-auto grid size-[5.2rem] select-none place-items-center rounded-[1.4rem] bg-tuk text-saffron active:bg-tuk-dark"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          set(true)();
        }}
        onPointerUp={set(false)}
        onPointerCancel={set(false)}
        onLostPointerCapture={set(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="painted-thin text-2xl leading-none">فرامل</span>
      </button>
    </div>
  );
}

function Dialogue() {
  const destination = useMissionState((s) => s.destination);
  const passenger = useMissionState((s) => s.passenger);
  const passenger2 = useMissionState((s) => s.passenger2);
  const who = [passenger, passenger2]
    .filter((p) => p >= 0)
    .map((p) => PASSENGERS[p % PASSENGERS.length].name)
    .join(" و");
  return (
    <div className="rise-in pointer-events-none absolute inset-x-0 top-[calc(max(10px,env(safe-area-inset-top))+150px)] flex justify-center px-4">
      <div className="relative max-w-sm rounded-2xl border-[2.5px] border-ink bg-cream px-4 py-2.5 shadow-[0_4px_0_#1a0d06]">
        <div className="text-xs font-black text-tuk">{who} 🗣️</div>
        <p className="text-[clamp(0.95rem,4vw,1.1rem)] font-black leading-snug">«{destination.line}»</p>
        <span className="absolute -bottom-2.5 right-8 size-4 rotate-45 border-b-[2.5px] border-r-[2.5px] border-ink bg-cream" aria-hidden />
      </div>
    </div>
  );
}

/** Between fares: a short card (fare earned, or what went wrong) — the shift goes on. */
function FareToast() {
  const phase = useMissionState((s) => s.phase);
  const fail = useMissionState((s) => s.fail);
  const result = useMissionState((s) => s.result);
  const trips = useMissionState((s) => s.trips);
  const lives = useMissionState((s) => s.lives);
  const ok = phase === "completed" && result;
  const text = !ok && fail ? MISSION_TEXT.fail[fail] : null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(max(10px,env(safe-area-inset-top))+150px)] flex justify-center px-4">
      <div
        className={`rise-in w-full max-w-xs rounded-2xl border-[2.5px] border-ink px-4 py-2.5 text-center shadow-[0_4px_0_#1a0d06] ${ok ? "bg-nile" : "bg-tuk"}`}
        style={{ animationDelay: fail === "crash" ? "0.8s" : "0s" }}
        role="status"
      >
        <div className="painted-thin text-2xl leading-[1.35] text-saffron">{ok ? `${MISSION_TEXT.arrived} +${result.total}` : text?.title}</div>
        <p className="text-sm font-bold text-cream">
          {ok ? MISSION_TEXT.thanks[trips % MISSION_TEXT.thanks.length] : lives > 0 ? `${text?.body} راحت عليك فرصة 💔` : text?.body}
        </p>
        {lives > 0 && <p className="mt-1 text-xs font-black text-saffron">زبون جديد مستنيك.. 🛺</p>}
      </div>
    </div>
  );
}

/** Shift stats chip: score, fares delivered, lives. */
function ShiftStats() {
  const score = useMissionState((s) => s.score);
  const fares = useMissionState((s) => s.fares);
  const lives = useMissionState((s) => s.lives);
  return (
    <div className="mt-1 flex items-center gap-2 text-xs font-black">
      <span className="rounded-full bg-ink px-2 py-0.5 text-saffron tabular-nums">{score}</span>
      <span className="text-ink/70">مشاوير: {fares}</span>
      <span className="mr-auto flex gap-0.5" aria-label={`${lives} فرص`}>
        {Array.from({ length: MISSION.lives }, (_, i) => (
          <Heart key={i} className={`size-3.5 ${i < lives ? "fill-tuk text-tuk" : "text-ink/30"}`} strokeWidth={2.6} aria-hidden />
        ))}
      </span>
    </div>
  );
}

function MissionEnd() {
  const result = useMissionState((s) => s.result);
  const best = useMissionState((s) => s.best);
  const trips = useMissionState((s) => s.trips);
  const score = useMissionState((s) => s.score);
  const fares = useMissionState((s) => s.fares);
  const again = () => {
    audio.unlock();
    missionActions.newShift();
    gameActions.enterMode("taxi", "playing");
  };
  const isBest = !!result?.isBest && score >= best && score > 0;
  return (
    <div className="absolute inset-0 grid place-items-center overflow-y-auto bg-ink/45 p-4 backdrop-blur-[2px]" data-ui>
      <div
        className="plate rise-in w-full max-w-sm overflow-hidden"
        style={{ animationDelay: "0.35s" }}
        role="dialog"
        aria-modal
        aria-labelledby="mission-end-title"
      >
        <div className="border-b-[3px] border-ink bg-tuk px-4 pb-3 pt-4 text-center">
          <h2 id="mission-end-title" className="painted text-[clamp(1.8rem,7.5vw,2.4rem)] leading-[1.3] text-saffron">
            الوردية خلصت 🛺
          </h2>
        </div>
        <div className="fringe" aria-hidden />
        <div className="px-5 pb-5 pt-2">
          <p className="text-center font-black text-ink/80">الفرص خلصت.. روّح ارتاح وتعالى بكرة 😴</p>
          {isBest && (
            <div className="wobble mx-auto mt-2 w-fit rounded-full border-[2.5px] border-ink bg-saffron px-4 py-1 font-black shadow-[0_3px_0_#1a0d06]">
              أحسن وردية ليك! 🏆
            </div>
          )}
          <dl className="mt-3 space-y-1 rounded-2xl border-[2.5px] border-ink bg-white/70 p-3 text-sm font-bold">
            <div className="flex justify-between">
              <dt>مشاوير الوردية</dt>
              <dd className="tabular-nums">{fares}</dd>
            </div>
            <div className="flex justify-between border-t-2 border-ink/20 pt-1 text-base font-black">
              <dt>المجموع</dt>
              <dd className="painted-thin text-2xl leading-none text-saffron tabular-nums">{score}</dd>
            </div>
          </dl>
          <p className="mt-2 flex items-center justify-center gap-3 text-xs font-bold text-ink/70">
            <span className="flex items-center gap-1">
              <Trophy className="size-3.5" strokeWidth={2.6} aria-hidden />
              أحسن وردية: <b className="tabular-nums">{best}</b>
            </span>
            <span>
              كل مشاويرك: <b className="tabular-nums">{trips}</b>
            </span>
          </p>
          <button
            type="button"
            autoFocus
            onClick={again}
            className="btn-sticker mt-4 flex w-full items-center justify-center gap-2 bg-tuk py-3 text-2xl text-saffron"
          >
            <RotateCcw className="size-6 stroke-saffron" strokeWidth={3} aria-hidden />
            <span className="painted-thin">وردية جديدة 🛺</span>
          </button>
          <button type="button" onClick={() => gameActions.toMenu()} className="btn-sticker mt-3 flex w-full items-center justify-center gap-2 bg-cream py-2.5 text-xl">
            <Home className="size-5" strokeWidth={2.6} aria-hidden />
            القائمة الرئيسية
          </button>
        </div>
      </div>
    </div>
  );
}

function PausePanel() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-ink/45 p-4 backdrop-blur-[2px]" data-ui>
      <div className="plate rise-in w-full max-w-sm space-y-3 p-5" role="dialog" aria-modal aria-label="اللعبة واقفة">
        <h2 className="painted text-center text-4xl leading-[1.3] text-saffron">استراحة شاي ☕</h2>
        <button type="button" autoFocus onClick={() => gameActions.resume()} className="btn-sticker flex w-full items-center justify-center gap-2 bg-tuk py-3 text-2xl text-saffron">
          <Play className="size-6 fill-saffron stroke-ink" strokeWidth={2} aria-hidden />
          <span className="painted-thin">كمّل المشوار</span>
        </button>
        <button type="button" onClick={() => gameActions.toMenu()} className="btn-sticker flex w-full items-center justify-center gap-2 bg-cream py-2.5 text-xl">
          <Home className="size-5" strokeWidth={2.6} aria-hidden />
          القائمة الرئيسية
        </button>
      </div>
    </div>
  );
}

export default function MissionHUD() {
  const status = useGameState((s) => s.status);
  const sound = useGameState((s) => s.sound);
  const phase = useMissionState((s) => s.phase);
  const destination = useMissionState((s) => s.destination);
  const group = useMissionState((s) => s.passenger2 >= 0);
  const tripId = useMissionState((s) => s.tripId);
  const finished = phase === "shiftOver";
  const between = phase === "completed" || phase === "failed";
  const goalLabel = between ? "استنى الزبون الجاي.." : toPassenger(phase) ? (group ? "زبونين مستنيينك" : "الزبون مستنيك") : `رايح: ${destination.name}`;

  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="flex items-start gap-2 px-3 pt-[max(10px,env(safe-area-inset-top))]">
        <div className="pointer-events-auto flex flex-col gap-2" data-ui>
          <button
            type="button"
            aria-label={status === "paused" ? "كمّل" : "وقف اللعبة"}
            onClick={() => gameActions.togglePause()}
            disabled={finished}
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

        {/* Compact navigation card */}
        <div className="relative min-w-0 flex-1 rounded-2xl border-[2.5px] border-ink bg-cream/95 px-3 pb-3.5 pt-2 shadow-[0_4px_0_#1a0d06]">
          <div className="mb-1.5 flex items-center gap-1.5">
            <MapPin className="size-4 shrink-0 text-tuk" strokeWidth={2.8} aria-hidden />
            <span className="painted-thin truncate text-xl leading-[1.35] text-saffron">{goalLabel}</span>
          </div>
          <ShiftStats />
          {!finished && !between && <NavLive />}
        </div>
      </div>
      {/* Quick fade as the next fare's streets load in. */}
      <div key={tripId} className="fare-fade pointer-events-none absolute inset-0 bg-cream" aria-hidden />
      {between && <FareToast />}

      {phase === "missionStart" && (
        <div className="rise-in pointer-events-none absolute inset-x-0 top-[calc(max(10px,env(safe-area-inset-top))+150px)] flex justify-center px-4">
          <div className="rounded-2xl border-[2.5px] border-ink bg-saffron px-4 py-2 text-center text-[clamp(0.95rem,4vw,1.1rem)] font-black shadow-[0_4px_0_#1a0d06]">
            {group ? MISSION_TEXT.introGroup : MISSION_TEXT.intro} 🙋
          </div>
        </div>
      )}
      {phase === "passengerOnboard" && <Dialogue />}
      {phase === "pickupAvailable" && <ZonePrompt text={MISSION_TEXT.pickupPrompt} />}
      {phase === "arriving" && <ZonePrompt text={MISSION_TEXT.dropPrompt} />}
      {phase === "boarding" && (
        <div className="rise-in pointer-events-none absolute inset-x-0 bottom-[130px] flex justify-center">
          <div className="rounded-full border-2 border-ink bg-cream px-4 py-1.5 font-black shadow-[0_3px_0_#1a0d06]">اتفضل يا فندم.. نوّرت 🙏</div>
        </div>
      )}

      {!finished && status !== "paused" && <BrakePedal />}
      {!finished && (
        <p className="pointer-events-none absolute bottom-[max(18px,env(safe-area-inset-bottom))] left-4 hidden text-xs font-bold text-ink/70 [@media(pointer:fine)]:block">
          ↓ أو S للفرامل • ← → للتحريك
        </p>
      )}
      {status === "paused" && (
        <div className="pointer-events-auto">
          <PausePanel />
        </div>
      )}
      {finished && (
        <div className="pointer-events-auto">
          <MissionEnd />
        </div>
      )}
    </div>
  );
}
