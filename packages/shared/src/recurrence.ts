/**
 * When a chore comes around, modelled on the iCalendar recurrence rule that
 * Google Calendar and Outlook both put behind their "Custom repeat" dialog.
 *
 * Deliberately a subset: chores repeat weekly or monthly, and they never end.
 * There is no COUNT/UNTIL because a chore stops by being switched off, and no
 * yearly frequency because nobody sweeps the porch once a year.
 *
 * The date math here is all local-midnight arithmetic. Nothing in a family's
 * week is worth a timezone library, but everything is worth being right about
 * on the day the clocks change — so days are stepped with `setDate`, which
 * respects DST, rather than by adding milliseconds.
 */

/** How the interval is counted. `RRULE:FREQ=`, minus the parts we don't offer. */
export type Freq = 'weekly' | 'monthly';

/**
 * One chore's repeat rule.
 *
 * For `weekly`, `byDay` carries the selected days and the month fields are null.
 * For `monthly`, exactly one of `byMonthDay` ("on the 15th") or `bySetPos`
 * ("on the third Monday", with the weekday in `byDay[0]`) is set — the same
 * either/or Google offers in its monthly dropdown.
 */
export interface Recurrence {
  freq: Freq;
  /** Every N weeks or months. Always >= 1; 1 is the plain "every week" case. */
  interval: number;
  /** Days of the week, `0` Sunday through `6` Saturday. Never empty. */
  byDay: number[];
  /** Monthly on a fixed date, 1–31. Null unless `freq` is monthly. */
  byMonthDay: number | null;
  /** Monthly on the Nth weekday: 1–4, or -1 for the last one. */
  bySetPos: number | null;
  /**
   * `YYYY-MM-DD`. Both the first day the chore can appear and the anchor the
   * interval counts from — "every 2 weeks" is meaningless without knowing
   * which week is week one, and Google uses the event's own start for this.
   */
  startsOn: string;
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
/** Single letters for the day picker. Two T's and two S's is the accepted cost. */
export const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/** Ordinals for the monthly "on the Nth weekday" rule, indexed by `bySetPos`. */
const ORDINALS: Record<number, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  [-1]: 'last',
};

// ---------- date helpers ----------

/** Local `YYYY-MM-DD`. */
export function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * `YYYY-MM-DD` as local midnight. `new Date('2026-08-05')` would parse as UTC
 * and land on the 4th for anyone west of Greenwich.
 */
export function fromYmd(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

const midnight = (d: Date): Date => {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

/** The Sunday on or before `d`. Only ever used to group weeks for interval math. */
const weekStart = (d: Date): Date => {
  const start = midnight(d);
  start.setDate(start.getDate() - start.getDay());
  return start;
};

/** Whole weeks from `a` to `b`, both snapped to their Sunday. */
const weeksBetween = (a: Date, b: Date): number =>
  Math.round((weekStart(b).getTime() - weekStart(a).getTime()) / (7 * 86400000));

const monthsBetween = (a: Date, b: Date): number =>
  (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());

/**
 * The date of the Nth `weekday` in a month, or 0 when the month hasn't got one
 * — a fifth Tuesday most months. Google skips those months rather than sliding
 * to the fourth, and so do we.
 */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, pos: number): number {
  if (pos === -1) {
    const last = new Date(year, month + 1, 0);
    return last.getDate() - ((last.getDay() - weekday + 7) % 7);
  }
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const date = 1 + offset + (pos - 1) * 7;
  return date > new Date(year, month + 1, 0).getDate() ? 0 : date;
}

// ---------- the rule itself ----------

/** The default a new chore starts on: every day, beginning today. */
export function everyDay(startsOn = toYmd(new Date())): Recurrence {
  return { freq: 'weekly', interval: 1, byDay: [...EVERY_DAY], byMonthDay: null, bySetPos: null, startsOn };
}

/** Whether a chore with this rule lands on one particular day. */
export function dueOn(rec: Recurrence, date: Date): boolean {
  const day = midnight(date);
  const start = fromYmd(rec.startsOn);
  if (day.getTime() < midnight(start).getTime()) return false;

  if (rec.freq === 'weekly') {
    if (!rec.byDay.includes(day.getDay())) return false;
    return weeksBetween(start, day) % rec.interval === 0;
  }

  if (monthsBetween(start, day) % rec.interval !== 0) return false;
  if (rec.byMonthDay !== null) return day.getDate() === rec.byMonthDay;
  const weekday = rec.byDay[0] ?? start.getDay();
  return nthWeekdayOfMonth(day.getFullYear(), day.getMonth(), weekday, rec.bySetPos ?? 1) === day.getDate();
}

/** Whether the rule lands anywhere inside a window of `days` starting at `from`. */
export function dueWithin(rec: Recurrence, from: Date, days: number): boolean {
  const cursor = midnight(from);
  for (let i = 0; i < days; i++) {
    if (dueOn(rec, cursor)) return true;
    cursor.setDate(cursor.getDate() + 1);
  }
  return false;
}

const sameDays = (a: number[], b: number[]): boolean =>
  a.length === b.length && b.every((d) => a.includes(d));

/** The days half of the label: "Every day", "Weekdays", "Mon, Wed, Fri". */
function describeDays(byDay: number[]): string {
  if (sameDays(byDay, EVERY_DAY)) return 'Every day';
  if (sameDays(byDay, WEEKDAYS)) return 'Weekdays';
  if (sameDays(byDay, WEEKEND)) return 'Weekends';
  return [...byDay].sort((a, b) => a - b).map((d) => DAY_SHORT[d]).join(', ');
}

/**
 * The rule in words, short enough for the tag on a chore row.
 *
 * The plain every-week case reads as just the days, so the common chore still
 * says "Weekdays" the way it always did and only unusual rules grow a suffix.
 */
export function describeRecurrence(rec: Recurrence): string {
  if (rec.freq === 'weekly') {
    const days = describeDays(rec.byDay);
    return rec.interval === 1 ? days : `${days} · every ${rec.interval} weeks`;
  }

  const every = rec.interval === 1 ? 'Monthly' : `Every ${rec.interval} months`;
  if (rec.byMonthDay !== null) return `${every} on day ${rec.byMonthDay}`;
  const weekday = DAY_NAMES[rec.byDay[0] ?? 0];
  return `${every} on the ${ORDINALS[rec.bySetPos ?? 1] ?? 'first'} ${weekday}`;
}

/** How the monthly options read in the picker, for a given start date. */
export function monthlyOptions(startsOn: string): { byMonthDay: string; bySetPos: string; pos: number } {
  const start = fromYmd(startsOn);
  const date = start.getDate();
  // Which occurrence of its own weekday the start date is — the 15th being a
  // Monday makes it the third Monday, so that is what the option offers.
  const pos = Math.ceil(date / 7);
  const isLast = date + 7 > new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const effective = pos > 4 || (isLast && pos === 5) ? -1 : pos;
  return {
    byMonthDay: `On day ${date}`,
    bySetPos: `On the ${ORDINALS[effective] ?? 'last'} ${DAY_NAMES[start.getDay()]}`,
    pos: effective,
  };
}

/**
 * Coerces whatever arrived over the wire into a rule that cannot break the
 * board — an empty day list or a zero interval would make a chore that is
 * never due and cannot be found again.
 */
export function normalizeRecurrence(input: Partial<Recurrence> | undefined | null): Recurrence {
  const fallback = everyDay();
  if (!input) return fallback;

  const freq: Freq = input.freq === 'monthly' ? 'monthly' : 'weekly';
  const interval = Math.min(52, Math.max(1, Math.round(Number(input.interval) || 1)));
  const startsOn =
    typeof input.startsOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.startsOn)
      ? input.startsOn
      : fallback.startsOn;

  const days = Array.isArray(input.byDay)
    ? [...new Set(input.byDay.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
        (a, b) => a - b,
      )
    : [];

  if (freq === 'weekly') {
    return {
      freq,
      interval,
      byDay: days.length ? days : [...EVERY_DAY],
      byMonthDay: null,
      bySetPos: null,
      startsOn,
    };
  }

  // Monthly is one rule or the other, never both. Day-of-month wins when the
  // payload is contradictory, since it is the option Google defaults to.
  const rawDay = Number(input.byMonthDay);
  const byMonthDay = Number.isInteger(rawDay) && rawDay >= 1 && rawDay <= 31 ? rawDay : null;
  const rawPos = Number(input.bySetPos);
  const bySetPos = [1, 2, 3, 4, -1].includes(rawPos) ? rawPos : null;

  if (byMonthDay !== null || bySetPos === null) {
    return {
      freq,
      interval,
      byDay: days.length ? days : [fromYmd(startsOn).getDay()],
      byMonthDay: byMonthDay ?? fromYmd(startsOn).getDate(),
      bySetPos: null,
      startsOn,
    };
  }

  return {
    freq,
    interval,
    byDay: days.length ? [days[0]!] : [fromYmd(startsOn).getDay()],
    byMonthDay: null,
    bySetPos,
    startsOn,
  };
}
