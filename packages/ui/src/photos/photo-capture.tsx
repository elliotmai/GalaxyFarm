"use client";

import { useId, useRef, type ChangeEvent } from "react";

/**
 * The control that gets a photograph into the app (spec §4.2).
 *
 * Issue #9 asks that "adding a photo is ≤2 taps from the animal's profile",
 * and that is the whole design of this: a label wrapping a hidden file input,
 * so the first tap opens the camera and the second is the shutter. Nothing in
 * between — no modal, no tab to find, no upload step afterwards. The bytes are
 * queued on the device and go up on the sync heartbeat, which is what makes
 * the same two taps work in a pen with no signal.
 *
 * A label rather than a button that clicks a hidden input, because a synthetic
 * click on a file input is blocked by every browser unless it is inside a
 * genuine user gesture, and "the camera did not open" is not a failure anybody
 * would report as a bug in a farm records app.
 *
 * `capture` is opt-in per surface: on the profile header it is the camera,
 * because somebody standing next to the animal wants the camera. In the
 * gallery it is left off so the same control also reaches the camera roll —
 * a photograph taken before the record existed is the ordinary case for a
 * purchase candidate.
 */

export interface PhotoCaptureProps {
  readonly onPick: (files: readonly File[]) => void;
  /** MIME types the picker offers. Defaults to any image. */
  readonly accept?: string;
  /** Ask for the camera directly rather than the picker. */
  readonly camera?: boolean;
  readonly multiple?: boolean;
  readonly label?: string;
  /** Shown instead of the label while a photo is being shrunk and queued. */
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly variant?: "primary" | "secondary";
}

const BASE =
  "inline-flex items-center justify-center gap-2 min-h-target min-w-target " +
  "rounded-density px-4 font-medium text-density leading-none " +
  "transition-colors cursor-pointer select-none " +
  "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-action";

const VARIANTS = {
  primary: "bg-action text-action-ink hover:opacity-90",
  secondary: "bg-panel text-ink border border-edge hover:bg-canvas",
} as const;

export function PhotoCapture({
  onPick,
  accept = "image/*",
  camera = false,
  multiple = true,
  label = "Add a photo",
  busy = false,
  disabled = false,
  variant = "secondary",
}: PhotoCaptureProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Cleared before the handler runs, so picking the same file twice in a row
    // still fires a change event. Without this, retaking a photo the phone
    // names `image.jpg` both times silently does nothing the second time.
    event.target.value = "";
    if (files.length > 0) onPick(files);
  }

  return (
    <label
      htmlFor={id}
      className={[BASE, VARIANTS[variant], disabled || busy ? "cursor-not-allowed opacity-50" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <input
        ref={input}
        id={id}
        type="file"
        // Named by `aria-label` as well as by the label element, so the
        // accessible name stays put while the visible text changes to
        // "Adding…". A control that renames itself mid-action is one a screen
        // reader user has to re-find.
        aria-label={label}
        aria-busy={busy}
        accept={accept}
        multiple={multiple}
        disabled={disabled || busy}
        onChange={pick}
        // Hidden from sight, not from the accessibility tree or the tab order:
        // `display: none` would take the control out of both, and the label
        // above is what gives it its name.
        className="sr-only"
        {...(camera ? { capture: "environment" as const } : {})}
      />
      {busy ? "Adding…" : label}
    </label>
  );
}
