"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Field } from "./field.js";

/**
 * A picker you can type into (spec §8, §4.5 clause 2).
 *
 * A plain `<select>` is right up to about thirty options and wrong after that.
 * The list this exists for is the ancestors: a five-generation pedigree is
 * thirty animals, and a herd with twenty papered cattle in it reaches several
 * hundred inside a year. Finding "CMAC DANDY'S SAMANTHA ET" by scrolling a
 * native dropdown on a phone, in a barn, is not a thing anybody will do twice.
 *
 * What matters here, in order:
 *
 * 1. **Typing filters, it does not create.** Every value comes from the list.
 *    A free-text field that quietly accepts a name nobody has on file is how
 *    a pedigree ends up pointing at a bull that does not exist.
 * 2. **The match is on everything shown**, not just the name — a registration
 *    number is what somebody has in front of them off the paper, and it is
 *    often the only thing they can read off a worn tag.
 * 3. **It works from the keyboard.** Arrows move, Enter picks, Escape closes
 *    and puts back what was there. A picker that needs a mouse is a picker
 *    that cannot be used with gloves on.
 *
 * Deliberately not a native `<datalist>`: Safari renders it as a hint rather
 * than a filter, and nothing about which option is highlighted is announced.
 */

export interface SearchOption {
  readonly value: string;
  readonly label: string;
  /** Shown greyed beside the label and searched with it — a number, a tattoo. */
  readonly detail?: string | undefined;
  /** Heading this option sits under. Options keep the order they arrive in. */
  readonly group?: string | undefined;
}

export interface SearchSelectProps {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly required?: boolean | undefined;
  readonly hideLabel?: boolean | undefined;
  readonly options: readonly SearchOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Shown when nothing is chosen. */
  readonly placeholder?: string | undefined;
  /** Offered as the first row, so a parent can be cleared. */
  readonly clearLabel?: string | undefined;
  /**
   * Let a value that is not on the list be used, as an explicit last row.
   *
   * Off by default and deliberately so: a parent field that quietly accepts a
   * name nobody has on file is how a pedigree ends up pointing at a bull that
   * does not exist. It is switched on for the fields where an outside name is
   * genuinely the answer — a straw from a bull this farm will never own — and
   * even then the row has to be *chosen*, so nothing is created by typing and
   * walking away.
   */
  readonly allowCustom?: ((typed: string) => string) | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
}

const CONTROL =
  "w-full min-h-target rounded-density border bg-panel px-3 text-density text-ink " +
  "outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-60";

/**
 * Fold case and punctuation for comparison.
 *
 * Both spellings are kept: `SULL TINA'S SOLUTION ET` becomes
 * `sull tina s solution et sulltinassolutionet`. The spaced form is what makes
 * "tina sull" match in either order; the squashed one is what makes "tinas"
 * match, which is how the name is actually typed by somebody who does not
 * think about where the apostrophe went.
 */
const fold = (value: string): string => {
  const spaced = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `${spaced} ${spaced.replace(/ /g, "")}`;
};

/**
 * Every word typed has to appear somewhere in the option.
 *
 * Words rather than a substring, so "sull tina" finds "SULL TINA'S SOLUTION
 * ET" and the order they are typed in does not matter — which is how somebody
 * reading a name off a certificate types it.
 */
export function matchesSearch(option: SearchOption, search: string): boolean {
  const words = search
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "");
  const haystack = fold(`${option.label} ${option.detail ?? ""} ${option.group ?? ""}`);
  return words.every((word) => haystack.includes(word));
}

export function SearchSelect({
  label,
  hint,
  error,
  required,
  hideLabel,
  options,
  value,
  onChange,
  placeholder,
  clearLabel,
  allowCustom,
  disabled,
  className,
}: SearchSelectProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  const chosen = options.find((option) => option.value === value);

  const matches = useMemo(() => {
    // The clear row only when nothing has been typed. Leaving it at the top of
    // a filtered list means Enter on a search that found one animal picks
    // "Unknown" instead — which reads as the picker ignoring you.
    if (search.trim() === "") {
      return clearLabel === undefined ? [...options] : [{ value: "", label: clearLabel }, ...options];
    }
    const found = options.filter((option) => matchesSearch(option, search));
    if (allowCustom === undefined) return found;
    // Last, never first: the list is what somebody is looking for, and a
    // "use what I typed" row above it would be picked by a hurried Enter.
    const typed = search.trim();
    const exact = found.some((option) => option.label.toLowerCase() === typed.toLowerCase());
    return exact ? found : [...found, { value: typed, label: allowCustom(typed) }];
  }, [options, search, clearLabel, allowCustom]);

  // Clicking away closes without changing anything. A picker that swallowed
  // the click that dismissed it is a picker that eats a keystroke every time.
  useEffect(() => {
    if (!open) return undefined;
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const pick = (option: SearchOption) => {
    onChange(option.value);
    setOpen(false);
    setSearch("");
  };

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => {
        const next = current + step;
        if (next < 0) return matches.length - 1;
        if (next >= matches.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      const option = matches[active];
      if (option !== undefined) pick(option);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setSearch("");
    }
  }

  let lastGroup: string | undefined;

  return (
    <Field
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
      {...(required === undefined ? {} : { required })}
      {...(hideLabel === undefined ? {} : { hideLabel })}
      {...(className === undefined ? {} : { className })}
    >
      {({ id, describedBy, invalid }) => (
        <div ref={root} className="relative">
          <input
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-describedby={describedBy}
            aria-invalid={invalid}
            aria-activedescendant={open ? `${listId}-${active}` : undefined}
            autoComplete="off"
            disabled={disabled ?? false}
            className={[CONTROL, invalid ? "border-danger" : "border-edge"].join(" ")}
            // Showing the chosen label when closed and the search when open is
            // what makes one box do both jobs. Clearing the search on close is
            // what stops a half-typed name reading as a selection.
            // A custom value has no option to look up, so it shows as itself.
            value={open ? search : (chosen?.label ?? value)}
            placeholder={placeholder ?? "Search…"}
            onChange={(event) => {
              setSearch(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />

          {!open ? null : (
            <ul
              id={listId}
              role="listbox"
              aria-label={label}
              className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-density border border-edge bg-panel shadow-xl"
            >
              {matches.length === 0 ? (
                <li className="px-density py-density text-density text-muted">
                  Nothing on file matches that.
                </li>
              ) : (
                matches.map((option, index) => {
                  const heading = option.group !== undefined && option.group !== lastGroup;
                  lastGroup = option.group;

                  return (
                    <li key={`${option.value}-${index}`}>
                      {!heading ? null : (
                        <p className="border-t border-edge px-density pt-2 text-sm font-medium text-muted first:border-t-0">
                          {option.group}
                        </p>
                      )}
                      <button
                        type="button"
                        id={`${listId}-${index}`}
                        role="option"
                        aria-selected={option.value === value}
                        // `onMouseDown` rather than `onClick`: the input's blur
                        // fires first otherwise and the list is gone before the
                        // click lands.
                        onMouseDown={(event) => {
                          event.preventDefault();
                          pick(option);
                        }}
                        onMouseEnter={() => setActive(index)}
                        className={[
                          "flex w-full items-baseline justify-between gap-3 px-density py-2 text-left text-density",
                          index === active ? "bg-action/10 text-ink" : "text-ink",
                        ].join(" ")}
                      >
                        <span>{option.label}</span>
                        {option.detail === undefined ? null : (
                          <span className="text-sm text-muted">{option.detail}</span>
                        )}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}
