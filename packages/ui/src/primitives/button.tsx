"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * The button (spec §8).
 *
 * Every variant is at least `min-h-target` tall, which is 36px on a laptop,
 * 44px on a phone, and 64px on a kiosk — the density tokens decide, so a
 * button written once is right on all three. Nothing here names a theme or a
 * surface.
 *
 * `danger` is a colour, not a confirmation. Destructive actions still route
 * through `useConfirmDelete` (§4.5 clause 3); a red button that fires on one
 * tap is exactly what that clause exists to prevent.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  /** Fill the width of its container — the default on a phone form. */
  readonly block?: boolean;
  /** Shown in place of the label while an action is in flight. */
  readonly busy?: boolean;
  readonly children?: ReactNode;
}

const BASE =
  "inline-flex items-center justify-center gap-2 min-h-target min-w-target " +
  "rounded-density px-4 font-medium text-density leading-none " +
  "transition-colors cursor-pointer select-none " +
  // Focus has to survive on both themes and on top of a filled button, so it
  // is an offset ring rather than an outline that would sit on the fill.
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-action text-action-ink hover:opacity-90",
  secondary: "bg-panel text-ink border border-edge hover:bg-canvas",
  ghost: "bg-transparent text-ink hover:bg-panel",
  danger: "bg-danger text-panel hover:opacity-90",
};

export function Button({
  variant = "secondary",
  block = false,
  busy = false,
  disabled,
  className,
  children,
  type = "button",
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      // Defaulting to "button": a bare <button> inside a form submits it, and
      // a row-action button that reloads the page is a bug people report as
      // "it lost my work".
      type={type}
      className={[BASE, VARIANTS[variant], block ? "w-full" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled ?? false}
      // Busy is announced rather than disabled: a control that vanishes from
      // the tab order mid-action throws a screen reader out of the place it
      // was. The click is dropped instead.
      aria-disabled={busy || (disabled ?? false)}
      aria-busy={busy}
      onClick={busy ? undefined : onClick}
      {...rest}
    >
      {children}
    </button>
  );
}
