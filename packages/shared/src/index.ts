/**
 * Types shared by the API and the web client.
 *
 * Field names follow the prototype in `Family Dashboard.dc.html` where the
 * design already settled on a vocabulary (hue, role, repeat, points).
 */

import type { Recurrence } from './recurrence.js';

export * from './recurrence.js';
export * from './rrule.js';
export * from './who.js';

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
export type PhotoTransition = 'fade' | 'slide' | 'zoom' | 'none';
export type PhotoOrder = 'shuffle' | 'album';
export type PhotoFit = 'fill' | 'fit';
export type PhotoDim = 'low' | 'medium' | 'high';
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
  /** The first of `personIds`, or null when it is empty. */
  personId: string | null;
  /**
   * Who is actually going, read out of the event itself rather than carried
   * by Google — a family event is often some of the house and not all of it,
   * and the kids have no email address to be a real attendee with.
   *
   * Most specific first: a `Who:` tag in the description, then a name in the
   * title's own leading words, then whoever the calendar itself belongs to.
   * See `whoFromDescription` and `whoFromTitle`.
   */
  personIds: string[];
  title: string;
  location: string | null;
  description: string | null;
  /**
   * A timed event carries a full ISO 8601 instant, offset included.
   *
   * An all-day event carries a bare `YYYY-MM-DD` instead, because that is what
   * it actually is: a calendar date, with no time and no timezone. Pinning it to
   * an instant would mean choosing a zone to pin it in, and whichever zone the
   * server happened to be running in would then decide which day the panel drew
   * it on. Resolve these with `eventStart`/`eventEnd` at the point of display.
   *
   * `end` is exclusive in both forms — an all-day event on Aug 30 ends
   * `2026-08-31`, which is exactly the half-open interval the overlap tests want.
   */
  start: string;
  end: string;
  allDay: boolean;
  /** True when the event came from a read-only subscription. */
  readOnly: boolean;
  /**
   * The series this occurrence belongs to, when Google expanded one. Null for a
   * one-off. Editing or deleting a repeating event has to say which it means.
   */
  seriesId: string | null;
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
  /** Who is going. Stored by Hearth; never sent to Google. */
  personIds?: string[];
  /** How it repeats, or null for a one-off. */
  recurrence?: Recurrence | null;
  /**
   * Which part of a repeating event a write means: just this occurrence, or the
   * whole series. Ignored for an event that does not repeat.
   */
  scope?: 'this' | 'all';
}

/** A bare `YYYY-MM-DD`, the form an all-day boundary takes. */
export function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Turn an event boundary into a `Date` for comparing and drawing.
 *
 * Timed boundaries are instants already. A date-only boundary is resolved to
 * midnight *where the viewer is*, built from its parts rather than parsed —
 * `new Date('2026-08-30')` is defined to mean UTC midnight, which lands on the
 * evening of the 29th for anyone west of Greenwich and is the reason all-day
 * events used to render a day early and across two days.
 *
 * Because the zone comes from the browser doing the drawing, no timezone is
 * assumed or configured anywhere: the panel in the kitchen resolves a date to
 * its own midnight, and would still be right if the API ran in UTC.
 */
export function resolveBoundary(value: string): Date {
  if (!isDateOnly(value)) return new Date(value);
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

export const eventStart = (event: Pick<CalendarEvent, 'start'>): Date => resolveBoundary(event.start);
export const eventEnd = (event: Pick<CalendarEvent, 'end'>): Date => resolveBoundary(event.end);

export interface GoogleAccount {
  id: string;
  email: string;
  connectedAt: string;
  lastSyncAt: string | null;
  /** Set when the refresh token was rejected and the account needs re-consent. */
  error: string | null;
}

/** A calendar assigned to a role rather than one person. */
export type CalendarGroup = 'parent' | 'kid' | 'all';

export interface SubscribedCalendar {
  id: string;
  accountId: string;
  googleCalendarId: string;
  summary: string;
  description: string | null;
  /** Exactly one of these is set, or neither for an unassigned calendar. */
  personId: string | null;
  group: CalendarGroup | null;
  /**
   * Whose color this calendar's events take on, and — for an event Hearth
   * never tagged — who it belongs to: `personId` alone, or every person
   * `group` currently resolves to against the household's own roster.
   */
  personIds: string[];
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
  interfaceSize: 'Compact' | 'Standard' | 'Large';
  idleMin: number;
  /** The source used behind the clock in frame mode. Credentials stay server-side. */
  photoProvider: 'none' | 'immich';
  photoAlbumId: string | null;
  photoDuration: 10 | 20 | 30 | 60;
  photoTransition: PhotoTransition;
  photoOrder: PhotoOrder;
  photoFit: PhotoFit;
  photoDim: PhotoDim;
  // Security
  pinSet: boolean;
}

export type HomeConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
export type HomeCategory = 'security' | 'covers' | 'climate' | 'lights' | 'batteries' | 'media' | 'other';

export interface HomeEntityDetails {
  currentTemperature: number | null;
  targetTemperature: number | null;
  humidity: number | null;
  brightness: number | null;
  position: number | null;
  batteryLevel: number | null;
}

/** The small, stable slice of a Home Assistant state that Hearth renders. */
export interface HomeEntityState {
  entityId: string;
  state: string;
  name: string;
  domain: string;
  deviceClass: string | null;
  deviceId: string | null;
  area: string | null;
  unit: string | null;
  lastChanged: string | null;
  available: boolean;
  details: HomeEntityDetails;
}

export function homeCategoryFor(entity: Pick<HomeEntityState, 'domain' | 'deviceClass' | 'name'>): HomeCategory {
  const kind = entity.deviceClass ?? '';
  const name = entity.name.toLowerCase();
  if (kind === 'battery' || name.includes('battery') || name.includes('charge level')) return 'batteries';
  if (entity.domain === 'alarm_control_panel' || entity.domain === 'lock' ||
      ['door', 'window', 'opening', 'garage_door', 'smoke', 'gas', 'carbon_monoxide', 'moisture', 'safety', 'tamper', 'problem'].includes(kind)) return 'security';
  if (entity.domain === 'cover') return 'covers';
  if (entity.domain === 'climate' || ['temperature', 'humidity'].includes(kind)) return 'climate';
  if (entity.domain === 'light' || (entity.domain === 'switch' && /light|lamp|dimmer/i.test(name))) return 'lights';
  if (['media_player', 'camera'].includes(entity.domain)) return 'media';
  return 'other';
}

/**
 * Something needing a household member's attention as soon as possible — a
 * triggered alarm, a jammed lock, a low battery, smoke or water detected.
 * Unconditional, with no per-item opt-out, since these are never just normal
 * operation.
 */
export function homeAlertActive(entity: Pick<HomeEntityState, 'domain' | 'deviceClass' | 'name' | 'state' | 'available'>): boolean {
  if (!entity.available) return false;
  if (entity.domain === 'lock') return entity.state === 'jammed';
  if (entity.domain === 'alarm_control_panel') return entity.state === 'triggered' || entity.state === 'pending';
  if (homeCategoryFor(entity) === 'batteries') {
    if (entity.domain === 'binary_sensor') return entity.state === 'on';
    const level = Number.parseFloat(entity.state);
    return Number.isFinite(level) && level <= 20;
  }
  if (entity.domain === 'binary_sensor') {
    return ['smoke', 'gas', 'carbon_monoxide', 'moisture', 'problem', 'tamper', 'safety'].includes(entity.deviceClass ?? '') && entity.state === 'on';
  }
  return ['jammed', 'triggered', 'detected', 'problem'].includes(entity.state);
}

/**
 * A door open, a lock unlocked, a cover raised — normal, expected operation,
 * not something needing attention. Always shown on the screen saver, the same
 * way a {@link homeAlertActive} entity is, but never as an alert: it doesn't
 * belong in "needs attention" and shouldn't turn a tile red.
 */
export function homeStatusNotable(entity: Pick<HomeEntityState, 'domain' | 'deviceClass' | 'state' | 'available'>): boolean {
  if (!entity.available) return false;
  if (entity.domain === 'lock') return entity.state === 'unlocked';
  if (entity.domain === 'cover') return entity.state === 'open' || entity.state === 'opening';
  if (entity.domain === 'binary_sensor') return ['door', 'window', 'opening', 'garage_door'].includes(entity.deviceClass ?? '') && entity.state === 'on';
  return false;
}

export interface HomeDashboardItem extends HomeEntityState {
  displayName: string;
  sortOrder: number;
  alertActive: boolean;
  alertLabel: string | null;
  statusActive: boolean;
  statusLabel: string | null;
  related: HomeEntityState[];
}

export interface HomeDashboard {
  connection: HomeConnectionState;
  stale: boolean;
  items: HomeDashboardItem[];
}

export interface HomeCandidate extends HomeEntityState {
  selected: boolean;
  displayName: string;
}

export interface HomeDashboardSelection {
  entityId: string;
  deviceId?: string | null;
  displayName: string | null;
}

export interface HomeDeviceCandidate {
  deviceId: string;
  name: string;
  area: string | null;
  manufacturer: string | null;
  model: string | null;
  primaryEntityId: string;
  category: HomeCategory;
  selected: boolean;
  entities: HomeCandidate[];
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
  interfaceSize: 'Standard',
  idleMin: 5,
  photoProvider: 'none',
  photoAlbumId: null,
  photoDuration: 20,
  photoTransition: 'fade',
  photoOrder: 'shuffle',
  photoFit: 'fill',
  photoDim: 'medium',
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
