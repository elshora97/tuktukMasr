"use client";

import { useGameState } from "@/hooks/useGameState";
import type { FloatingLabel } from "@/lib/gameStore";

function OvertakeLabel({ label }: { label: FloatingLabel }) {
  const close = label.kind === "close";
  return (
    <div
      className="overtake-label absolute whitespace-nowrap text-center"
      style={{ left: `clamp(7.5rem, ${label.x}%, calc(100% - 7.5rem))`, top: `${label.y}%` }}
      dir="rtl"
    >
      <div
        className={`painted text-[clamp(1.5rem,6.5vw,2.4rem)] leading-[1.35] ${close ? "text-[#ff7ab8]" : "text-saffron"}`}
      >
        {label.text}
      </div>
      <div className="painted-thin -mt-1 text-[clamp(1rem,4vw,1.35rem)] leading-[1.3] text-cream">{label.sub}</div>
    </div>
  );
}

/** Floating Egyptian-Arabic shout-outs on successful overtakes (state-driven, throttled in the store). */
export default function OvertakeLabels() {
  const labels = useGameState((s) => s.labels);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-live="polite">
      {labels.map((l) => (
        <OvertakeLabel key={l.id} label={l} />
      ))}
    </div>
  );
}
