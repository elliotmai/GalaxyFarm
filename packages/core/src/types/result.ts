/**
 * `Result` makes failure a value rather than a control-flow event.
 *
 * Use cases return it instead of throwing, because the failures this domain
 * cares about — a calving date before its breeding date, a straw count that
 * would go negative, a delete blocked by a dependent record — are ordinary
 * outcomes the UI has to render, not exceptions. Reserve `throw` for bugs.
 */

export type Result<T, E = string> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Transform the success value, leaving a failure untouched. */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Transform the error, leaving a success untouched. */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/** Chain an operation that may itself fail. */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Collect many results into one. Fails with *every* error rather than the
 * first, because a form that reports one problem at a time is a form people
 * fill in five times.
 */
export function all<T, E>(results: ReadonlyArray<Result<T, E>>): Result<T[], E[]> {
  const values: T[] = [];
  const errors: E[] = [];

  for (const result of results) {
    if (result.ok) values.push(result.value);
    else errors.push(result.error);
  }

  return errors.length > 0 ? err(errors) : ok(values);
}
