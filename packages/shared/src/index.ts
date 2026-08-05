/**
 * Types shared by the API and the web client.
 *
 * Field names follow the prototype in `Family Dashboard.dc.html` where the
 * design already settled on a vocabulary (hue, role, repeat, points).
 */

export type Role = 'kid' | 'parent' | 'shared';

/** Repeat rules a chore can carry. Mirrors REPEATS in the prototype. */
export type Repeat = 'Daily' | 'Weekdays' | 'Weekly' | 'Weekends';

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
  sortOrder: number;
}

export type PersonInput = Partial<Omit<Person, 'id'>> & { name: string };

export interface Chore {
  id: string;
  personId: string;
  title: string;
  repeat: Repeat;
  points: number;
  active: boolean;
  sortOrder: number;
  /** Whether it is checked off for the current board period. Derived, read-only. */
  done: boolean;
}

export type ChoreInput = Partial<Omit<Chore, 'id' | 'done'>> & { title: string; personId: string };

/** An optional job any kid can pick up for points. */
export interface Extra {
  id: string;
  title: string;
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
  points: number;
  done: boolean;
  claimedAt: string;
  completedAt: string | null;
}

export interface Reward {
  id: string;
  label: string;
  cost: number;
  active: boolean;
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
 */
export interface PointEvent {
  id: string;
  personId: string;
  delta: number;
  reason: string;
  refType: 'chore' | 'claim' | 'redemption' | 'manual';
  refId: string | null;
  createdAt: string;
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

export const REPEATS: readonly Repeat[] = ['Daily', 'Weekdays', 'Weekly', 'Weekends'];
export const ROLES: readonly Role[] = ['kid', 'parent', 'shared'];
export const MONTHS: readonly string[] = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
