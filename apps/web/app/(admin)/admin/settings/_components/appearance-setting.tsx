"use client";

import { type Appearance, useAppearance } from "@/lib/appearance";

const CHOICES: readonly { readonly value: Appearance; readonly label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "device", label: "Match device" },
];

/**
 * Light, dark or the device's own setting — for this device only.
 *
 * A segmented control rather than a select: three choices, all visible, one
 * tap. Said to apply to "this device" because it does — the other person's
 * phone keeps its own choice.
 */
export function AppearanceSetting() {
  const [appearance, setAppearance] = useAppearance();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-density border border-rule bg-panel px-density py-3">
      <div className="flex flex-col">
        <span id="appearance-label" className="text-density font-semibold text-ink">
          Appearance
        </span>
        <span className="text-sm text-muted">On this device</span>
      </div>
      <div
        role="radiogroup"
        aria-labelledby="appearance-label"
        className="flex gap-1 rounded-density bg-raised p-1"
      >
        {CHOICES.map((choice) => {
          const on = appearance === choice.value;
          return (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setAppearance(choice.value)}
              className={`min-h-target rounded-density px-3 text-sm ${
                on
                  ? "bg-panel font-semibold text-ink shadow-[0_1px_3px_rgba(20,23,27,0.15)]"
                  : "text-muted hover:text-ink"
              }`}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
