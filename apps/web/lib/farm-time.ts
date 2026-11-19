/**
 * The farm's wall clock, for code that runs somewhere other than the farm.
 *
 * The kernel's day arithmetic is local time on purpose (`date-range.ts`): a
 * chore is due on the day the person in the barn is having. On a kiosk, local
 * *is* the farm. On a Netlify function it is UTC, which puts an evening chore's
 * 8 pm deadline at 2 pm in Texas. Server code moves instants onto the farm's
 * wall clock with `wallClock`, runs the unchanged pure functions, and brings
 * any instant they produce back with `fromWallClock` before storing it.
 */

interface WallFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallFields(instant: Date, timeZone: string): WallFields {
  let format = formatters.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(
    format.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts["year"]),
    month: Number(parts["month"]),
    day: Number(parts["day"]),
    hour: Number(parts["hour"]),
    minute: Number(parts["minute"]),
    second: Number(parts["second"]),
  };
}

/**
 * The instant whose *local* fields read what a clock in `timeZone` reads at
 * `instant`. Only ever fed to the kernel's local-time arithmetic; never sent
 * anywhere or stored.
 */
export function wallClock(instant: Date, timeZone: string): Date {
  const f = wallFields(instant, timeZone);
  return new Date(
    f.year,
    f.month - 1,
    f.day,
    f.hour,
    f.minute,
    f.second,
    instant.getMilliseconds(),
  );
}

/**
 * Noon on `day` (`YYYY-MM-DD`) in `timeZone`, as a real instant.
 *
 * What a kiosk sends as the day being ticked — noon in its own timezone — so
 * the tick reaches `tickChore` exactly as the kiosk's would. Noon is never
 * near a daylight-saving change, so one correction step is exact.
 */
export function zonedNoon(day: string, timeZone: string): Date {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, date, 12, 0, 0);
  const f = wallFields(new Date(guess), timeZone);
  const offset = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) - guess;
  return new Date(guess - offset);
}

/** Every `Date` inside a record, moved onto the farm's wall clock. */
export function onWallClock<T>(value: T, timeZone: string): T {
  if (value instanceof Date) return wallClock(value, timeZone) as T;
  if (Array.isArray(value)) return value.map((item) => onWallClock(item, timeZone)) as T;
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, onWallClock(item, timeZone)]),
    ) as T;
  }
  return value;
}

/**
 * Every `Date` inside a value, brought back from the wall clock to a real
 * instant. The inverse of `onWallClock`, for results computed on the wall
 * clock that are about to go to a browser, which formats them in its own zone.
 */
export function offWallClock<T>(value: T, timeZone: string): T {
  if (value instanceof Date) return fromWallClock(value, timeZone) as T;
  if (Array.isArray(value)) return value.map((item) => offWallClock(item, timeZone)) as T;
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, offWallClock(item, timeZone)]),
    ) as T;
  }
  return value;
}

/**
 * The real instant at which a clock in `timeZone` reads the *local* fields of
 * `local` — the inverse of `wallClock`, for an instant the kernel produced on
 * the wall clock (a due time, say) that is about to be stored.
 *
 * Two correction passes, so a time on either side of a daylight-saving change
 * lands on the offset in force at that moment.
 */
export function fromWallClock(local: Date, timeZone: string): Date {
  const guess = Date.UTC(
    local.getFullYear(),
    local.getMonth(),
    local.getDate(),
    local.getHours(),
    local.getMinutes(),
    local.getSeconds(),
    local.getMilliseconds(),
  );
  let result = guess;
  for (let pass = 0; pass < 2; pass += 1) {
    const f = wallFields(new Date(result), timeZone);
    const shown = Date.UTC(
      f.year,
      f.month - 1,
      f.day,
      f.hour,
      f.minute,
      f.second,
      local.getMilliseconds(),
    );
    result -= shown - guess;
  }
  return new Date(result);
}

/** True for a timezone name this runtime can use. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
