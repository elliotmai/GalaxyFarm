import { useId } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/**
 * Form controls (spec §8, §4.5 clause 2).
 *
 * The contract that matters here is the error one. Clause 2 says errors
 * surface **per field**, so every control takes an `error` and wires it with
 * `aria-describedby` and `aria-invalid` — a form that reports "something went
 * wrong" at the top has told nobody which of eleven fields to fix.
 *
 * All three share `Field` so the label, the hint, the error, and the id
 * plumbing are written once. A control that forgot its label would be a
 * control nobody using a screen reader can fill in, and that is the sort of
 * thing that is easy to forget forty forms in.
 */

export interface FieldProps {
  readonly label: string;
  /** Steady guidance — units, format, where the number comes from. */
  readonly hint?: string;
  /** Set to show the field as failed. Replaces the hint while present. */
  readonly error?: string;
  readonly required?: boolean;
  readonly children: (ids: FieldIds) => ReactNode;
  readonly className?: string;
}

export interface FieldIds {
  readonly id: string;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
}

export function Field({ label, hint, error, required = false, children, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  // The error supersedes the hint rather than stacking with it: a field
  // showing both makes the reader work out which one is current.
  const describedBy = error !== undefined ? errorId : hint !== undefined ? hintId : undefined;

  return (
    <div className={["flex flex-col gap-1", className ?? ""].filter(Boolean).join(" ")}>
      <label htmlFor={id} className="text-density font-medium text-ink">
        {label}
        {required ? (
          <>
            {" "}
            <span className="text-danger" aria-hidden="true">
              *
            </span>
            <span className="sr-only">(required)</span>
          </>
        ) : null}
      </label>

      {children({ id, describedBy, invalid: error !== undefined })}

      {error !== undefined ? (
        // Polite rather than assertive: a validation message that interrupts
        // mid-word is worse than one that waits for a pause.
        <p id={errorId} role="alert" aria-live="polite" className="text-sm text-danger">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL =
  "w-full min-h-target rounded-density border bg-panel px-3 text-density text-ink " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-action " +
  "disabled:cursor-not-allowed disabled:opacity-50";

/** Red border alone would say nothing to someone who cannot see it — hence aria-invalid. */
const borderFor = (invalid: boolean) => (invalid ? "border-danger" : "border-edge");

export interface TextInputProps
  extends
    Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "required">,
    Omit<FieldProps, "children"> {
  /** Numbers that line up in a column — weights, tag numbers, straw counts. */
  readonly numeric?: boolean;
}

export function TextInput({
  label,
  hint,
  error,
  required,
  numeric = false,
  className,
  ...rest
}: TextInputProps) {
  return (
    <Field
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
      {...(required === undefined ? {} : { required })}
      {...(className === undefined ? {} : { className })}
    >
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          required={required ?? false}
          className={[CONTROL, borderFor(invalid), numeric ? "gf-numeric" : ""]
            .filter(Boolean)
            .join(" ")}
          {...rest}
        />
      )}
    </Field>
  );
}

export interface TextAreaProps
  extends
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className" | "required">,
    Omit<FieldProps, "children"> {}

export function TextArea({ label, hint, error, required, className, ...rest }: TextAreaProps) {
  return (
    <Field
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
      {...(required === undefined ? {} : { required })}
      {...(className === undefined ? {} : { className })}
    >
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          required={required ?? false}
          className={[CONTROL, borderFor(invalid), "py-2"].join(" ")}
          {...rest}
        />
      )}
    </Field>
  );
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectProps
  extends
    Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "className" | "required">,
    Omit<FieldProps, "children"> {
  readonly options: readonly SelectOption[];
  /** Shown as a disabled first row when nothing is chosen yet. */
  readonly placeholder?: string;
}

export function Select({
  label,
  hint,
  error,
  required,
  options,
  placeholder,
  className,
  ...rest
}: SelectProps) {
  return (
    <Field
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
      {...(required === undefined ? {} : { required })}
      {...(className === undefined ? {} : { className })}
    >
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          required={required ?? false}
          className={[CONTROL, borderFor(invalid)].join(" ")}
          {...rest}
        >
          {placeholder === undefined ? null : (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
}

/**
 * A checkbox, laid out label-beside-box rather than label-above.
 *
 * The whole row is the target, not just the 16px box — one-thumb logging in a
 * barn does not tolerate a 16px hit area, and the density tokens set the row's
 * height the same way they set every other control's.
 */
export function Checkbox({ label, hint, error, className, ...rest }: CheckboxProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error !== undefined ? errorId : hint !== undefined ? hintId : undefined;

  return (
    <div className={["flex flex-col gap-1", className ?? ""].filter(Boolean).join(" ")}>
      <label
        htmlFor={id}
        className="flex min-h-target cursor-pointer items-center gap-3 text-density text-ink"
      >
        <input
          id={id}
          type="checkbox"
          aria-describedby={describedBy}
          aria-invalid={error !== undefined}
          className="size-5 accent-[var(--gf-action)]"
          {...rest}
        />
        {label}
      </label>

      {error !== undefined ? (
        <p id={errorId} role="alert" aria-live="polite" className="text-sm text-danger">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
