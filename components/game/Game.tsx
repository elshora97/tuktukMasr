"use client";

import { Component, useEffect, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { gameActions, useGameState, useHydrateGameState } from "@/hooks/useGameState";
import { useGameControls } from "@/hooks/useGameControls";
import { useFontsReady } from "@/hooks/useFontsReady";
import { usePwa } from "@/hooks/usePwa";
import { audio } from "@/lib/audio";
import GameHUD from "./GameHUD";
import StartScreen from "./StartScreen";
import GameOverScreen from "./GameOverScreen";
import OvertakeLabels from "./OvertakeLabel";
import MissionHUD from "../mission/MissionHUD";
import RaceMenu from "../race/RaceMenu";
import RaceHUD from "../race/RaceHUD";
import { useRaceState } from "@/hooks/useRaceState";
import { raceActions } from "@/lib/race/raceClient";
import { RACE_ENABLED } from "@/lib/race/shared";
import { gameStore } from "@/lib/gameStore";

// Three.js must only run in the browser.
const GameCanvas = dynamic(() => import("./GameCanvas"), { ssr: false });

class CanvasErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(err: unknown) {
    console.error("3D scene crashed:", err);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="absolute inset-0 grid place-items-center bg-sand p-6" dir="rtl">
          <div className="plate max-w-sm p-5 text-center">
            <p className="painted-thin text-3xl leading-[1.4] text-saffron">التوكتوك عطل! 🔧</p>
            <p className="mt-2 font-bold">حصلت مشكلة في الرسوميات. جرّب تحدّث الصفحة أو تقفل الجرافيك العالي.</p>
            <button
              type="button"
              className="btn-sticker mt-4 w-full bg-tuk py-2 text-2xl text-saffron"
              onClick={() => {
                gameActions.setQuality("low");
                this.setState({ error: false });
              }}
            >
              <span className="painted-thin">جرّب تاني</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function Loading() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-sand" aria-busy>
      <div className="text-center">
        <p className="painted wobble text-5xl leading-[1.4] text-saffron">توكتوك كوبري مصر</p>
        <p className="mt-2 font-black text-ink/80">بنسخّن الموتور.. 🛺💨</p>
      </div>
    </div>
  );
}

export default function Game() {
  useHydrateGameState();
  usePwa(); // registers the service worker
  const surface = useRef<HTMLDivElement>(null);
  useGameControls(surface);
  const fontsReady = useFontsReady();
  const status = useGameState((s) => s.status);
  const showGameOver = useGameState((s) => s.showGameOver);
  const sound = useGameState((s) => s.sound);
  const quality = useGameState((s) => s.quality);
  const mode = useGameState((s) => s.mode);
  const racePhase = useRaceState((s) => s.room?.phase ?? null);

  useEffect(() => {
    audio.setMuted(!sound);
  }, [sound]);

  // Online race: the room's phase drives the game status (lobby = menu scene, countdown..results = race scene).
  useEffect(() => {
    const g = gameStore.getState();
    if (g.mode !== "race") return;
    const inRace = racePhase !== null && racePhase !== "lobby";
    if (inRace && g.status === "menu") gameActions.enterMode("race", "playing");
    else if (!inRace && g.status !== "menu") gameActions.toMenu("race");
  }, [racePhase, mode]);

  // Invite links (?room=ABCDE) open the race menu with the code filled in.
  useEffect(() => {
    if (RACE_ENABLED && new URLSearchParams(window.location.search).has("room")) {
      gameActions.toMenu("race");
      void raceActions.open();
    }
  }, []);

  // Pause and silence when the tab is hidden or the phone locks.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        gameActions.pause();
        audio.setSuspended(true);
      } else {
        audio.setSuspended(false);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <main ref={surface} className="game-surface fixed inset-0 overflow-hidden bg-sand" dir="rtl">
      <CanvasErrorBoundary>{fontsReady && <GameCanvas key={quality} />}</CanvasErrorBoundary>
      {!fontsReady && <Loading />}
      {fontsReady && (
        <>
          {mode === "endless" && <OvertakeLabels />}
          {status === "menu" && mode === "endless" && <StartScreen />}
          {status === "menu" && mode === "race" && <RaceMenu />}
          {mode === "endless" && (status === "playing" || status === "paused") && <GameHUD />}
          {mode === "endless" && status === "gameOver" && showGameOver && <GameOverScreen />}
          {mode === "taxi" && status !== "menu" && <MissionHUD />}
          {mode === "race" && status !== "menu" && <RaceHUD />}
        </>
      )}
    </main>
  );
}
