"use client";

import { useState } from "react";

import { Field } from "./field.js";

/**
 * A short list of words, edited in place (spec §8, §4.5 clause 2).
 *
 * Built for the fields where an animal has more than one of something and the
 * set is open — breed is the case it exists for. A crossbred cow is
 * Maine-Anjou *and* Angus, a dropdown of every breed in the world is unusable
 * on a phone at a chute, and a comma-separated text box means somebody's typo
 * becomes a breed nobody can filter by.
 *
 * Three decisions worth stating:
 *
 * **Suggestions, not a whitelist.** `suggestions` offers what the herd already
 * uses so spellings converge on their own, and anything else can still be
 * typed. A farm that buys one unusual bull should not have to wait for a code
 * change to record what he is.
 *
 * **Removing is one tap and no dialog.** These are not records — nothing
 * points at them, nothing is lost, and the confirmation rules in §4.5 exist
 * for deletions somebody cannot walk back. Making this ask twice would teach
 * people to click through dialogs that matter.
 *
 * **Enter adds, and so does leaving the box.** Typing a breed and tabbing away
 * expecting it to be there is what people do, and losing it is the sort of
 * quiet data loss nobody reports — they just retype it and think less of the
 * app.
 */
export interface TagInputProps {
  readonly label: string;
  readonly value: readonly string[];
  readonly onChange: (next: string[]) => void;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly placeholder?: string | undefined;
  /** Offered as you type. Not a limit on what can be entered. */
  readonly suggestions?: readonly string[] | undefined;
  readonly disabled?: boolean | undefined;
  /** Most fields do not need more than a handful, and none needs forty. */
  readonly max?: number | undefined;
}

export function TagInput({
  label,
  value,
  onChange,
  hint,
  error,
  placeholder,
  suggestions = [],
  disabled = false,
  max = 12,
}: TagInputProps) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const entry = raw.trim();
    if (entry === "" || value.length >= max) return;
    // Case-insensitively already there: "angus" typed under "Angus" is the
    // same breed, and two spellings of it split every filter that reads this.
    const already = value.some((held) => held.toLowerCase() === entry.toLowerCase());
    setDraft("");
    if (already) return;
    onChange([...value, entry]);
  };

  const remove = (entry: string) => {
    onChange(value.filter((held) => held !== entry));
  };

  /**
   * What to put in the list, each thing once.
   *
   * Deduped here rather than trusting the caller. A caller assembling
   * "what the herd already uses" plus "the breeds we know about" will hand
   * over the same word twice by construction, and a dropdown showing Chianina
   * three times looks broken in a way that makes the whole field look
   * untrustworthy.
   */
  const offered: string[] = [];
  const alreadyOffered = new Set(value.map((held) => held.toLowerCase()));
  for (const raw of suggestions) {
    const entry = raw.trim();
    if (entry === "") continue;
    // First spelling wins, not the last. A caller puts what the herd already
    // uses at the front precisely so it stays there — `new Map` would have
    // quietly kept the canonical spelling at the back instead.
    if (alreadyOffered.has(entry.toLowerCase())) continue;
    if (draft.trim() !== "" && !entry.toLowerCase().includes(draft.trim().toLowerCase())) continue;
    alreadyOffered.add(entry.toLowerCase());
    offered.push(entry);
  }

  return (
    <Field
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
    >
      {({ id, describedBy, invalid }) => (
        <div className="flex flex-col gap-2">
          {value.length === 0 ? null : (
            <ul className="flex flex-wrap gap-2" aria-label={`${label}, currently set`}>
              {value.map((entry) => (
                <li key={entry}>
                  <span className="inline-flex items-center gap-1 rounded-full border border-edge bg-raised px-3 py-1 text-sm text-ink">
                    {entry}
                    <button
                      type="button"
                      // crud-guard: allow-unconfirmed — a word out of a list, not a record
                      onClick={() => remove(entry)}
                      disabled={disabled}
                      aria-label={`Remove ${entry}`}
                      className="rounded-full px-1 text-muted hover:text-danger disabled:opacity-50"
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            value={draft}
            disabled={disabled || value.length >= max}
            // The browser offers its own form history alongside a datalist,
            // under a divider, and it does not know a breed from a cow's
            // name. An animal called Andromeda turned up in the breed list
            // because somebody had once typed it into a field the browser
            // decided was the same one.
            autoComplete="off"
            list={offered.length === 0 ? undefined : `${id}-suggestions`}
            placeholder={value.length >= max ? `That is as many as ${label} holds` : placeholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                // Not a submit. A form that saved because somebody finished
                // typing a breed would be a surprise every single time.
                event.preventDefault();
                add(draft);
                return;
              }
              // Backspace on an empty box takes the last one back off, which
              // is what every other chip field does.
              if (event.key === "Backspace" && draft === "" && value.length > 0) {
                // crud-guard: allow-unconfirmed — takes back the word just typed
                remove(value[value.length - 1] as string);
              }
            }}
            onBlur={() => add(draft)}
            className={`min-h-11 w-full rounded-md border bg-surface px-3 py-2 text-density text-ink ${
              invalid ? "border-danger" : "border-edge"
            }`}
          />

          {offered.length === 0 ? null : (
            <datalist id={`${id}-suggestions`}>
              {offered.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
          )}
        </div>
      )}
    </Field>
  );
}
