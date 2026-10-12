"use client";

import { Gamepad2, Sparkles, Volume2, VolumeX, Zap } from "lucide-react";
import { gameActions, useGameState } from "@/hooks/useGameState";
import { audio } from "@/lib/audio";

/** Sound / graphics quality / on-screen pad toggles. */
export default function SettingsButtons({ compact = false }: { compact?: boolean }) {
  const sound = useGameState((s) => s.sound);
  const quality = useGameState((s) => s.quality);
  const pads = useGameState((s) => s.showPads);
  const status = useGameState((s) => s.status);
  const size = compact ? "size-10" : "size-12";
  const icon = compact ? "size-5" : "size-6";

  const items = [
    {
      key: "sound",
      label: sound ? "اقفل الصوت" : "شغّل الصوت",
      active: sound,
      onClick: () => {
        audio.unlock();
        gameActions.setSound(!sound);
      },
      Icon: sound ? Volume2 : VolumeX,
      text: sound ? "الصوت شغّال" : "الصوت مقفول",
    },
    {
      key: "quality",
      label: quality === "high" ? "جودة عالية — دوس للتوفير" : "جودة موفّرة — دوس للعالية",
      active: quality === "high",
      // Switching remounts the 3D canvas; only allowed outside active driving.
      disabled: status === "playing",
      onClick: () => gameActions.setQuality(quality === "high" ? "low" : "high"),
      Icon: quality === "high" ? Sparkles : Zap,
      text: quality === "high" ? "جرافيك عالي" : "جرافيك موفّر",
    },
    {
      key: "pads",
      label: pads ? "إخفاء أزرار التحكم" : "إظهار أزرار التحكم",
      active: pads,
      onClick: () => gameActions.setShowPads(!pads),
      Icon: Gamepad2,
      text: pads ? "أزرار الشاشة ظاهرة" : "أزرار الشاشة مخفية",
    },
  ];

  if (compact) {
    return (
      <div className="flex shrink-0 gap-2 pt-1" data-ui>
        {items.map(({ key, label, active, onClick, Icon, disabled }) => (
          <button
            key={key}
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            aria-pressed={active}
            className={`btn-icon grid ${size} place-items-center ${active ? "bg-saffron" : "bg-cream/90"} disabled:opacity-50`}
          >
            <Icon className={icon} strokeWidth={2.6} aria-hidden />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2" data-ui>
      {items.map(({ key, label, active, onClick, Icon, text, disabled }) => (
        <button
          key={key}
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          className={`btn-icon flex flex-col items-center gap-1 px-1 py-2 text-xs font-bold ${active ? "bg-saffron" : "bg-white/70"} disabled:opacity-50`}
        >
          <Icon className={icon} strokeWidth={2.6} aria-hidden />
          {text}
        </button>
      ))}
    </div>
  );
}
