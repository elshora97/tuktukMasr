"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, Copy, Crown, DoorOpen, Flag, Loader2, LogIn, Plus, Share2, Users, WifiOff, X } from "lucide-react";
import { gameActions } from "@/hooks/useGameState";
import { useRaceState } from "@/hooks/useRaceState";
import { raceActions } from "@/lib/race/raceClient";
import { RACE, normalizeRoomId } from "@/lib/race/shared";
import { TUKTUK_PAINTS } from "../game/TukTuk";

function Shell({ title, children, onBack, backLabel }: { title: string; children: React.ReactNode; onBack: () => void; backLabel: string }) {
  return (
    <div className="absolute inset-0 flex items-end justify-center overflow-y-auto p-3 pb-[max(14px,env(safe-area-inset-bottom))] sm:items-center" data-ui>
      <div className="plate rise-in w-full max-w-md overflow-hidden">
        <div className="flex items-center gap-2 border-b-[3px] border-ink bg-nile px-3 py-2.5">
          <button type="button" onClick={onBack} aria-label={backLabel} className="btn-icon grid size-10 shrink-0 place-items-center bg-cream">
            <ArrowRight className="size-5" strokeWidth={2.8} aria-hidden />
          </button>
          <h2 className="painted min-w-0 flex-1 truncate text-[clamp(1.6rem,6.5vw,2.1rem)] leading-[1.35] text-saffron">{title}</h2>
          <Flag className="size-7 shrink-0 text-cream" strokeWidth={2.6} aria-hidden />
        </div>
        <div className="fringe" aria-hidden />
        <div className="space-y-3 px-4 pb-4 pt-1">{children}</div>
      </div>
    </div>
  );
}

function ErrorBox() {
  const error = useRaceState((s) => s.error);
  const connection = useRaceState((s) => s.connection);
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border-2 border-tuk bg-tuk/10 px-3 py-2 text-sm font-bold text-tuk-dark">
      {connection === "offline" ? <WifiOff className="mt-0.5 size-4 shrink-0" strokeWidth={2.6} aria-hidden /> : <X className="mt-0.5 size-4 shrink-0" strokeWidth={2.8} aria-hidden />}
      <span className="flex-1">{error}</span>
      <button type="button" onClick={() => raceActions.clearError()} className="text-xs underline">
        تمام
      </button>
    </div>
  );
}

function Entry() {
  const name = useRaceState((s) => s.name);
  const busy = useRaceState((s) => s.busy);
  const [code, setCode] = useState("");
  // Deep link: ?room=ABCDE pre-fills the code.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("room");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL on mount
    if (fromUrl) setCode(normalizeRoomId(fromUrl).slice(0, RACE.roomIdLength));
  }, []);
  const back = () => {
    raceActions.exit();
    gameActions.toMenu();
  };
  return (
    <Shell title="سباق مع صحابك 🏁" onBack={back} backLabel="رجوع للقائمة">
      <label className="block">
        <span className="mb-1 block text-sm font-black">اسمك في السباق</span>
        <input
          value={name}
          onChange={(e) => raceActions.setName(e.target.value)}
          maxLength={RACE.nameMax}
          placeholder="مثلاً: أسطى حمادة"
          autoComplete="nickname"
          className="w-full rounded-xl border-[2.5px] border-ink bg-white px-3 py-2.5 text-lg font-bold outline-none focus:border-nile"
        />
      </label>
      <ErrorBox />
      <button
        type="button"
        disabled={busy}
        onClick={() => void raceActions.createRoom()}
        className="btn-sticker flex w-full items-center justify-center gap-2 bg-tuk py-3 text-2xl text-saffron disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-6 animate-spin" aria-hidden /> : <Plus className="size-6" strokeWidth={3} aria-hidden />}
        <span className="painted-thin">إنشاء غرفة</span>
      </button>
      <div className="flex items-center gap-3 text-sm font-black text-ink/60">
        <span className="h-0.5 flex-1 bg-ink/20" />
        أو عندك كود من صاحبك؟
        <span className="h-0.5 flex-1 bg-ink/20" />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void raceActions.joinRoom(code);
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(normalizeRoomId(e.target.value).slice(0, RACE.roomIdLength))}
          placeholder="ABCDE"
          aria-label="كود الأوضة"
          dir="ltr"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-xl border-[2.5px] border-ink bg-white px-3 py-2 text-center font-mono text-2xl font-black tracking-[0.3em] uppercase outline-none focus:border-nile"
        />
        <button
          type="submit"
          disabled={busy || code.length !== RACE.roomIdLength}
          className="btn-sticker flex shrink-0 items-center gap-1.5 bg-nile px-4 text-xl text-cream disabled:opacity-50"
        >
          <LogIn className="size-5" strokeWidth={2.8} aria-hidden />
          دخول غرفة
        </button>
      </form>
      <p className="text-center text-xs font-bold text-ink/60">
        من {RACE.minPlayers} لـ {RACE.maxPlayers} لاعيبة • السباق {(RACE.distance / 1000).toFixed(1)} كم على الكوبري
      </p>
    </Shell>
  );
}

function Lobby() {
  const room = useRaceState((s) => s.room)!;
  const myId = useRaceState((s) => s.myId);
  const busy = useRaceState((s) => s.busy);
  const notice = useRaceState((s) => s.notice);
  const connection = useRaceState((s) => s.connection);
  const [copied, setCopied] = useState(false);
  const me = room.players.find((p) => p.id === myId);
  const isHost = room.hostId === myId;
  const connected = room.players.filter((p) => p.connected);
  const notReady = connected.filter((p) => p.id !== room.hostId && !p.ready);
  const canStart = connected.length >= room.minPlayers && notReady.length === 0;
  const reason =
    connected.length < room.minPlayers ? `مستنيين ${room.minPlayers - connected.length} كمان على الأقل` : notReady.length > 0 ? `مستنيين ${notReady.map((p) => p.name).join("، ")}` : "";

  const inviteText = `تعالى نتسابق بالتوكتوك على الكوبري! 🛺🏁 كود الأوضة: ${room.id}`;
  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}/?room=${room.id}` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(room.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "توكتوك كوبري مصر", text: inviteText, url: inviteUrl });
        return;
      } catch {
        /* cancelled — fall back to copying */
      }
    }
    try {
      await navigator.clipboard.writeText(`${inviteText}\n${inviteUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <Shell title="أوضة السباق" onBack={() => raceActions.leave()} backLabel="اخرج من الأوضة">
      {/* Room code */}
      <div className="rounded-2xl border-[2.5px] border-ink bg-white/80 p-3 text-center">
        <div className="text-xs font-black text-ink/60">كود الأوضة — ابعته لصحابك</div>
        <div dir="ltr" className="font-mono text-[2.6rem] font-black leading-tight tracking-[0.25em] text-ink" data-testid="room-code">
          {room.id}
        </div>
        <div className="mt-1 flex gap-2">
          <button type="button" onClick={() => void copy()} className="btn-icon flex flex-1 items-center justify-center gap-1.5 bg-cream py-1.5 font-black">
            {copied ? <Check className="size-4 text-nile" strokeWidth={3} aria-hidden /> : <Copy className="size-4" strokeWidth={2.6} aria-hidden />}
            {copied ? "اتنسخ!" : "نسخ الكود"}
          </button>
          <button type="button" onClick={() => void share()} className="btn-icon flex flex-1 items-center justify-center gap-1.5 bg-saffron py-1.5 font-black">
            <Share2 className="size-4" strokeWidth={2.6} aria-hidden />
            ابعت لصحابك
          </button>
        </div>
      </div>

      {notice && (
        <div role="status" className="rise-in rounded-xl bg-ink/85 px-3 py-1.5 text-center text-sm font-bold text-cream">
          {notice}
        </div>
      )}
      {connection === "reconnecting" && (
        <div role="status" className="flex items-center justify-center gap-2 rounded-xl bg-saffron/40 px-3 py-1.5 text-sm font-bold">
          <Loader2 className="size-4 animate-spin" aria-hidden /> النت قطع.. بنحاول نرجّعك
        </div>
      )}

      {/* Players */}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-sm font-black">
          <Users className="size-4" strokeWidth={2.6} aria-hidden />
          اللاعيبة ({room.players.length}/{room.maxPlayers})
        </div>
        <ul className="space-y-1.5" data-testid="player-list">
          {room.players.map((p) => {
            const host = p.id === room.hostId;
            return (
              <li key={p.id} className="flex items-center gap-2 rounded-xl border-2 border-ink/80 bg-white/80 px-2.5 py-1.5" data-player={p.name}>
                <span className="size-5 shrink-0 rounded-md border-2 border-ink" style={{ background: TUKTUK_PAINTS[p.paint % TUKTUK_PAINTS.length].main }} aria-hidden />
                <span className="min-w-0 flex-1 truncate font-black">
                  {p.name}
                  {p.id === myId && <span className="mr-1 text-xs font-bold text-ink/60">(إنت)</span>}
                </span>
                {host && (
                  <span className="flex items-center gap-0.5 rounded-full bg-saffron px-2 py-0.5 text-xs font-black" title="صاحب الأوضة">
                    <Crown className="size-3.5" strokeWidth={2.8} aria-hidden /> صاحب الأوضة
                  </span>
                )}
                {!host && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-black ${p.ready ? "bg-nile text-cream" : "bg-ink/10"}`}>{p.ready ? "جاهز ✓" : "مش جاهز"}</span>
                )}
                <span
                  className={`size-2.5 shrink-0 rounded-full ${p.connected ? "bg-[#2ecc71]" : "animate-pulse bg-[#f39c12]"}`}
                  title={p.connected ? "متصل" : "النت قاطع عنده"}
                  aria-label={p.connected ? "متصل" : "النت قاطع عنده"}
                />
              </li>
            );
          })}
        </ul>
      </div>

      <ErrorBox />

      {isHost ? (
        <>
          <button
            type="button"
            disabled={!canStart || busy}
            onClick={() => void raceActions.start()}
            className="btn-sticker flex w-full items-center justify-center gap-2 bg-tuk py-3 text-2xl text-saffron disabled:opacity-50"
          >
            <Flag className="size-6" strokeWidth={2.8} aria-hidden />
            <span className="painted-thin">ابدأ السباق</span>
          </button>
          {!canStart && <p className="text-center text-sm font-bold text-ink/70">{reason}</p>}
          <button type="button" onClick={() => raceActions.closeRoom()} className="flex w-full items-center justify-center gap-1.5 text-sm font-black text-tuk-dark underline">
            <DoorOpen className="size-4" strokeWidth={2.6} aria-hidden /> اقفل الأوضة
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => raceActions.setReady(!me?.ready)}
            className={`btn-sticker flex w-full items-center justify-center gap-2 py-3 text-2xl ${me?.ready ? "bg-cream" : "bg-nile text-cream"}`}
          >
            {me?.ready ? "مش جاهز لسه ✋" : "أنا جاهز ✓"}
          </button>
          <p className="text-center text-sm font-bold text-ink/70">صاحب الأوضة هو اللي هيبدأ السباق</p>
        </>
      )}
    </Shell>
  );
}

export default function RaceMenu() {
  const screen = useRaceState((s) => s.screen);
  const room = useRaceState((s) => s.room);
  return screen === "lobby" && room ? <Lobby /> : <Entry />;
}
