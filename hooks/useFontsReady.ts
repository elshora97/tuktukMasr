"use client";

import { useEffect, useState } from "react";
import { fontStack } from "@/lib/textures";

/**
 * Returns true once the Arabic web fonts are loaded so canvas textures
 * (road signs, stickers) can be drawn with proper glyph shaping.
 */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const done = () => alive && setReady(true);
    if (typeof document === "undefined" || !document.fonts) {
      done();
      return;
    }
    const timeout = setTimeout(done, 2500); // never block on slow font CDNs
    Promise.all([
      document.fonts.load(`700 40px ${fontStack("body")}`, "عربي"),
      document.fonts.load(`400 40px ${fontStack("display")}`, "عربي"),
    ])
      .catch(() => undefined)
      .then(() => document.fonts.ready)
      .finally(() => {
        clearTimeout(timeout);
        done();
      });
    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, []);
  return ready;
}
