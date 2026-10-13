"use client";

import { useEffect, type RefObject } from "react";
import { PLAYER } from "@/lib/gameConfig";
import { gameActions, gameStore, runtime } from "@/lib/gameStore";
import { audio } from "@/lib/audio";

const clampX = (x: number) => Math.max(-PLAYER.xLimit, Math.min(PLAYER.xLimit, x));

/**
 * Unified steering input bound to the game surface:
 *  - Touch / pen: press and drag anywhere; horizontal finger travel maps to
 *    lateral travel (relative, so the finger never covers the tuk-tuk).
 *  - Mouse: the pointer's horizontal position maps to the road (absolute).
 *  - Keyboard: ←/→ or A/D steer, Space/H honks, P/Esc pauses, Enter starts.
 * The render loop smooths runtime.targetX into runtime.playerX.
 */
export function useGameControls(surface: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const playing = () => gameStore.getState().status === "playing" && runtime.crashT < 0;

    let dragId: number | null = null;
    let lastX = 0;
    const keys = { left: false, right: false };
    const syncKeys = () => {
      runtime.keySteer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    };

    const onPointerDown = (e: PointerEvent) => {
      audio.unlock();
      if (e.pointerType === "mouse") return;
      if (!playing()) return;
      // Buttons and other UI inside the surface don't start a steering drag.
      if ((e.target as HTMLElement | null)?.closest?.("[data-ui]")) return;
      dragId = e.pointerId;
      lastX = e.clientX;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!playing()) return;
      const rect = el.getBoundingClientRect();
      if (e.pointerType === "mouse") {
        const nx = (e.clientX - rect.left) / rect.width - 0.5;
        runtime.targetX = clampX(nx * 2 * PLAYER.xLimit * 1.25);
        return;
      }
      if (e.pointerId !== dragId) return;
      // Dragging ~75% of the screen width sweeps across the whole road.
      const metersPerPx = (PLAYER.xLimit * 2) / (rect.width * 0.75);
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      runtime.targetX = clampX(runtime.targetX + dx * metersPerPx);
    };
    const endDrag = (e: PointerEvent) => {
      if (e.pointerId === dragId) dragId = null;
    };

    // Typing a name or room code must not steer, brake or pause.
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      const status = gameStore.getState().status;
      if (k === "arrowdown" || k === "s") {
        // Brake (passenger missions).
        runtime.brake = true;
        e.preventDefault();
      } else if (k === "arrowleft" || k === "a") {
        keys.left = true;
        syncKeys();
        e.preventDefault();
      } else if (k === "arrowright" || k === "d") {
        keys.right = true;
        syncKeys();
        e.preventDefault();
      } else if (k === " " || k === "h") {
        if (status === "playing") {
          audio.unlock();
          gameActions.horn();
          e.preventDefault();
        }
      } else if (k === "p" || k === "escape") {
        gameActions.togglePause();
      } else if (k === "enter") {
        audio.unlock();
        if (status === "menu" && gameStore.getState().mode === "endless") gameActions.start();
        else if (status === "paused") gameActions.resume();
        else if (status === "gameOver" && gameStore.getState().showGameOver) gameActions.start();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      if (k === "arrowdown" || k === "s") {
        runtime.brake = false;
        return;
      }
      if (k === "arrowleft" || k === "a") keys.left = false;
      else if (k === "arrowright" || k === "d") keys.right = false;
      else return;
      syncKeys();
    };
    const onBlur = () => {
      keys.left = keys.right = false;
      syncKeys();
      runtime.padSteer = 0;
      runtime.brake = false;
      gameActions.pause();
    };
    // Block page scroll / pull-to-refresh / pinch while on the game surface.
    const prevent = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    const preventWhilePlaying = (e: Event) => {
      if (gameStore.getState().status === "playing" && e.cancelable) e.preventDefault();
    };

    // iOS only lets audio start/resume on user-activation events (touchend /
    // pointerup / click — not touch pointerdown). Any tap revives the sound,
    // including after the lock screen or a phone call interrupted it.
    const unlockAudio = () => audio.unlock();
    window.addEventListener("touchend", unlockAudio, { passive: true });
    window.addEventListener("pointerup", unlockAudio, { passive: true });
    window.addEventListener("click", unlockAudio, { passive: true });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
    el.addEventListener("lostpointercapture", endDrag);
    el.addEventListener("touchmove", preventWhilePlaying, { passive: false });
    el.addEventListener("contextmenu", prevent);
    el.addEventListener("gesturestart", prevent as EventListener);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("touchend", unlockAudio);
      window.removeEventListener("pointerup", unlockAudio);
      window.removeEventListener("click", unlockAudio);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endDrag);
      el.removeEventListener("pointercancel", endDrag);
      el.removeEventListener("lostpointercapture", endDrag);
      el.removeEventListener("touchmove", preventWhilePlaying);
      el.removeEventListener("contextmenu", prevent);
      el.removeEventListener("gesturestart", prevent as EventListener);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [surface]);
}
