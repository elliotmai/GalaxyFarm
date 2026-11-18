"use client";

import type { ButtonHTMLAttributes, ReactNode, SVGAttributes } from "react";

import { buttonClass, FAB_CLASS, type ButtonVariant } from "./button-styles.js";

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

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  /** Fill the width of its container — the default on a phone form. */
  readonly block?: boolean;
  /** Shown in place of the label while an action is in flight. */
  readonly busy?: boolean;
  readonly children?: ReactNode;
}

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
      className={buttonClass(variant, { block, ...(className === undefined ? {} : { className }) })}
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

/**
 * The plus on every "add" control.
 *
 * Drawn, not typed. A typed "+" takes the metrics of whichever face the
 * density loaded — thin in the serif, heavy in the condensed kiosk face, and
 * never centred on the label beside it — so the same action looked like three
 * different glyphs on three screens. Sized in `em`, so it follows the label.
 */
export function PlusIcon({
  size = "1.05em",
  className,
  ...rest
}: SVGAttributes<SVGSVGElement> & { readonly size?: string | number }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      className={["shrink-0", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export interface FabProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** What tapping it adds: "Add animal", "Record a calving". */
  readonly children: ReactNode;
}

/**
 * The phone's add button, floating bottom-right where a thumb already is and
 * clear of the tab bar. Not drawn on anything wider, where the same action
 * sits in the page header.
 *
 * It was written out by hand on fifteen screens — the same eighteen classes
 * pasted each time, plus two local components with different props — so a
 * change to its height or its shadow meant fifteen edits and usually got
 * twelve. It opens a sheet, so it says so to assistive technology.
 */
export function Fab({ children, className, type = "button", ...rest }: FabProps) {
  return (
    <button
      type={type}
      aria-haspopup="dialog"
      className={[FAB_CLASS, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      <PlusIcon size={20} />
      {children}
    </button>
  );
}
