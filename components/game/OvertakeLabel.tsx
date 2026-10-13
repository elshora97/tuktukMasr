"use client";

import { useGameState } from "@/hooks/useGameState";
import type { FloatingLabel } from "@/lib/gameStore";
import { bindAnchorElement } from "@/lib/screenAnchors";

/** Small pill pinned to the passed car; positioned every frame by the anchor tracker. */
function OvertakeLabel({ label }: { label: FloatingLabel }) {
  const id = `label-${label.id}`;
  return (
    <div ref={(el) => bindAnchorElement(id, el)} className="absolute left-0 top-0 will-change-transform" dir="rtl">
      <div className="close-label flex items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-ink/80 bg-ink/75 px-2.5 py-0.5 shadow-[0_2px_0_#1a0d06]">
        <span className="text-[clamp(0.8rem,3.2vw,0.95rem)] font-black leading-tight text-saffron">{label.text}</span>
        <span className="text-[0.75rem] font-black leading-tight text-[#7ff0e6] tabular-nums" dir="ltr">
          {label.sub}
        </span>
      </div>
    </div>
  );
}

/** Close-overtake shout-outs (state-driven; throttled and capped in the store). */
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
