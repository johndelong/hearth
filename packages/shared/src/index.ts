/**
 * Types shared by the API and the web client.
 *
 * Field names follow the prototype in `Family Dashboard.dc.html` where the
 * design already settled on a vocabulary (hue, role, repeat, points).
 */

import type { Recurrence } from './recurrence.js';

export * from './recurrence.js';

export type Role = 'kid' | 'parent';

/**
 * Which part of the day a chore belongs to. Purely organisational — it groups
 * the board into sections and has no bearing on when a chore is due, which is
 * entirely the recurrence rule's business.
 */
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'any';

/** Board order: through the day, with the unscoped chores last. */
export const TIMES_OF_DAY: readonly TimeOfDay[] = ['morning', 'afternoon', 'evening', 'any'];

export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  any: 'Any time',
};

/** How often every chore board clears itself. */
export type ChoreReset = 'Every night' | 'Sunday' | 'Monday';

export type ThemeMode = 'Auto' | 'Day' | 'Night';
export type WeekStart = 'Sunday' | 'Monday';
export type DayHours = '6a – 10p' | '7a – 9p' | 'All 24';
export type CalView = 'day' | 'week' | 'month';

export interface Person {
  id: string;
  name: string;
  /** OKLCH hue, 0–360. `-1` renders as the neutral slate used for shared calendars. */
  hue: number;
  role: Role;
  /** Birthday as `M-D`, e.g. `8-31`. Null when unset. */
  bday: string | null;
  byear: number | null;
  onChores: boolean;
  onCal: boolean;
  /** Reward this kid is currently saving toward. */
  goalRewardId: string | null;
  avatarUrl: string | null;
  /** One of the built-in avatar faces. A photo, when set, wins over it. */
  avatarKey: string | null;
  sortOrder: number;
}

export type PersonInput = Partial<Omit<Person, 'id'>> & { name: string };

/**
 * A chore as a rule: one title that can land on several people at once, the way
 * "Make the bed" lands on every kid who has a bed. What each of them has
 * actually done lives in `BoardChore`.
 */
export interface Chore {
  id: string;
  /** Everyone this chore is assigned to. Never empty in practice. */
  personIds: string[];
  title: string;
  /** What the chore is. Shown in the details modal. Null when unset. */
  description: string | null;
  /** How to do it — the step-by-step half of the details modal. */
  instructions: string | null;
  /** When this chore comes around. See `Recurrence`. */
  recurrence: Recurrence;
  /** Which section of the board it sits under. Never affects whether it is due. */
  timeOfDay: TimeOfDay;
  active: boolean;
  sortOrder: number;
}

export type ChoreInput = Partial<Omit<Chore, 'id'>> & { title: string; personIds: string[] };

/**
 * One person's copy of a chore on today's board. A chore assigned to three kids
 * produces three of these, each checked off independently.
 */
export interface BoardChore {
  choreId: string;
  personId: string;
  title: string;
  description: string | null;
  instructions: string | null;
  recurrence: Recurrence;
  timeOfDay: TimeOfDay;
  sortOrder: number;
  /** Checked off by this person, for the current board period. */
  done: boolean;
  /**
   * Local `YYYY-MM-DD` the tick actually happened, which is not always the day
   * it counts for — a chore due Sunday may have been done on Friday. Null when
   * it has not been done.
   */
  completedOn: string | null;
}

/** An optional job any kid can pick up for points. */
export interface Extra {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  points: number;
  active: boolean;
}

export type ExtraInput = Partial<Omit<Extra, 'id'>> & { title: string };

/** A kid claiming an extra job. Becomes points once it is checked off. */
export interface Claim {
  id: string;
  extraId: string;
  personId: string;
  title: string;
  description: string | null;
  instructions: string | null;
  points: number;
  done: boolean;
  /**
   * Whether the points have actually landed in the ledger. An extra job can be
   * finished before the day's required chores are, and when it is the points
   * wait rather than being refused — see `releaseClaimPoints`.
   */
  paid: boolean;
  claimedAt: string;
  completedAt: string | null;
}

export interface Reward {
  id: string;
  label: string;
  cost: number;
  active: boolean;
  /** Photo for the catalog card. Takes precedence over `icon`. */
  imageUrl: string | null;
  /** Emoji shown when there is no photo. Falls back to the gift glyph. */
  icon: string | null;
}

export type RewardInput = Partial<Omit<Reward, 'id'>> & { label: string };

export interface Redemption {
  id: string;
  personId: string;
  rewardId: string | null;
  label: string;
  cost: number;
  redeemedAt: string;
}

/**
 * Points are an append-only ledger rather than a running total, so a mis-tap
 * can be reversed and the history stays explainable to a kid.
 *
 * Only extra jobs and redemptions move points. Regular chores are the
 * baseline expectation and pay nothing.
 */
export interface PointEvent {
  id: string;
  personId: string;
  delta: number;
  reason: string;
  refType: 'claim' | 'redemption' | 'manual';
  refId: string | null;
  createdAt: string;
}

/**
 * How many board periods in a row someone has finished every required chore.
 * Derived from completion history on each read, never stored.
 */
export interface Streak {
  personId: string;
  length: number;
  /** While paused, the streak neither grows nor breaks. */
  paused: boolean;
  /** First day of the run, `YYYY-MM-DD`. Null when there is no streak. */
  since: string | null;
}

export interface PointsBalance {
  personId: string;
  points: number;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  /** Person the owning calendar is mapped to, or null for unmapped calendars. */
  personId: string | null;
  title: string;
  location: string | null;
  description: string | null;
  /** ISO 8601. For all-day events this is the local midnight boundary. */
  start: string;
  end: string;
  allDay: boolean;
  /** True when the event came from a read-only subscription. */
  readOnly: boolean;
  /** Synthesized locally (birthdays), so it has no Google counterpart. */
  synthetic: boolean;
}

export interface EventInput {
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  location?: string | null;
  description?: string | null;
}

export interface GoogleAccount {
  id: string;
  email: string;
  connectedAt: string;
  lastSyncAt: string | null;
  /** Set when the refresh token was rejected and the account needs re-consent. */
  error: string | null;
}

export interface SubscribedCalendar {
  id: string;
  accountId: string;
  googleCalendarId: string;
  summary: string;
  description: string | null;
  /** Which family member's color this calendar's events take on. */
  personId: string | null;
  enabled: boolean;
  /** Google's accessRole is reader/freeBusyReader — we cannot write events here. */
  readOnly: boolean;
  primary: boolean;
}

export interface Settings {
  // Calendar
  weekStart: WeekStart;
  dayHours: DayHours;
  showAllDay: boolean;
  birthdaysOnCal: boolean;
  // Chores
  choreReset: ChoreReset;
  claimExtras: boolean;
  choreConfetti: boolean;
  // Display
  theme: ThemeMode;
  idleMin: number;
  playful: boolean;
  navModel: 'sidebar' | 'tabs';
  // Security
  pinSet: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  weekStart: 'Sunday',
  dayHours: '6a – 10p',
  showAllDay: true,
  birthdaysOnCal: true,
  choreReset: 'Every night',
  claimExtras: true,
  choreConfetti: true,
  theme: 'Auto',
  idleMin: 5,
  playful: true,
  navModel: 'sidebar',
  pinSet: false,
};

/** Named hues offered in the person editor. Mirrors SWATCHES in the prototype. */
export const SWATCHES: ReadonlyArray<readonly [string, number]> = [
  ['Rose', 350],
  ['Coral', 25],
  ['Amber', 68],
  ['Green', 148],
  ['Teal', 196],
  ['Blue', 258],
  ['Violet', 305],
  ['Slate', -1],
];

export const ROLES: readonly Role[] = ['kid', 'parent'];
export const MONTHS: readonly string[] = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
