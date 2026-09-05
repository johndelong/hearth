import { homeCategoryFor, type HomeDashboardItem } from '@dashboard/shared';

/**
 * The design language from `Family Dashboard.dc.html`, extracted so every screen
 * draws from one source. Colors are OKLCH hues: each family member owns a hue,
 * and every surface tied to that person is derived from it.
 */

export const EASE = 'cubic-bezier(.2,.8,.25,1)';

/** Strong version of a person's hue — dots, borders, progress fills. */
export function col(hue: number, night: boolean): string {
  if (hue < 0) return night ? '#9aa0b2' : '#6d7484';
  return night ? `oklch(0.78 0.13 ${hue})` : `oklch(0.68 0.14 ${hue})`;
}

/**
 * Tinted background wash for cards and chips.
 *
 * Night keeps the hue rather than collapsing to a grey overlay. Whose chip this
 * is has to survive the dark theme — a board where every person washes out to
 * the same white film loses the one thing the colours were for, and it left
 * `col()` as the only tinted thing on screen, which is why the odd saturated
 * border stood out so badly.
 */
export function soft(hue: number, night: boolean): string {
  if (hue < 0) return night ? 'rgba(255,255,255,.07)' : 'rgba(30,34,48,.05)';
  return night ? `oklch(0.32 0.05 ${hue})` : `oklch(0.96 0.028 ${hue})`;
}

/**
 * Lift under an avatar.
 *
 * The ground behind a pack face is the person's colour at full strength, which
 * is the point — but a saturated disc on a light card has no edge of its own.
 * A small shadow gives it one without a border, which would compete with the
 * ring some avatars already carry.
 */
export const AVATAR_LIFT =
  '0 1px 2px rgba(20,24,40,.14), 0 5px 12px -4px rgba(20,24,40,.34)';

/**
 * Readable text color on top of `soft()`.
 *
 * Light and dark are mirror images: dark saturated ink on a pale wash, light
 * saturated ink on a dark one. Both keep well clear of their background in
 * lightness, which is what carries the contrast — the hue only says whose it is.
 */
export function deep(hue: number, night: boolean): string {
  if (hue < 0) return night ? '#eef0f6' : '#2b3040';
  return night ? `oklch(0.88 0.08 ${hue})` : `oklch(0.4 0.09 ${hue})`;
}

export interface HomeTone {
  background: string;
  ink: string;
  accent: string;
}

/** Airy category palette used by Home tiles, controls, and section headings. */
export function homeTone(hue: number, night: boolean): HomeTone {
  if (hue === 25) return night
    ? { background: '#3a1d1c', ink: '#ffaaa4', accent: '#e6534d' }
    : { background: '#fceceb', ink: '#a92824', accent: '#cf2b26' };
  if (hue === 68 || hue === 55) return night
    ? { background: '#3a2a12', ink: '#f5c47a', accent: hue === 55 ? '#ff9f57' : '#e79c2a' }
    : { background: hue === 55 ? '#fdf0e4' : '#fdecd2', ink: hue === 55 ? '#8a4a10' : '#8a5200', accent: hue === 55 ? '#e8791f' : '#e79c2a' };
  if (hue === 165) return night
    ? { background: '#12332d', ink: '#7fd8c4', accent: '#2fa38c' }
    : { background: '#d5f1ea', ink: '#0c5a4c', accent: '#2fa38c' };
  if (hue === 258 || hue === 245) return night
    ? { background: '#16263d', ink: '#9cc2f2', accent: '#3f7fd6' }
    : { background: '#e3ecfb', ink: '#1c4c8c', accent: '#3f7fd6' };
  if (hue === 305) return night
    ? { background: '#231d3d', ink: '#b9abf5', accent: '#7561d8' }
    : { background: '#e9e6fb', ink: '#3f2f8f', accent: '#7561d8' };
  return night
    ? { background: '#1a1f26', ink: '#eef1f5', accent: '#8d959f' }
    : { background: '#fff', ink: '#16202b', accent: '#8b949e' };
}

/** The category hue behind a Home Assistant tile's icon, active tone, and screen-saver status color. */
export function homeVisualHue(entity: Pick<HomeDashboardItem, 'domain' | 'deviceClass' | 'name'>): number {
  if (entity.domain === 'alarm_control_panel' || homeCategoryFor(entity) === 'security') return 258;
  if (homeCategoryFor(entity) === 'covers' || homeCategoryFor(entity) === 'media') return 305;
  if (homeCategoryFor(entity) === 'climate' || homeCategoryFor(entity) === 'other') return 165;
  if (entity.domain === 'light' || homeCategoryFor(entity) === 'lights' || homeCategoryFor(entity) === 'batteries') return 68;
  if (['switch', 'input_boolean', 'fan'].includes(entity.domain)) return 305;
  return -1;
}

export const CARD_SHADOW = '0 1px 2px rgba(20,24,40,.05),0 16px 34px -22px rgba(20,24,40,.26)';

export const initialOf = (name: string): string => (name || '?').trim().charAt(0).toUpperCase();

/**
 * Icon glyph names from Material Symbols Rounded (self-hosted, see
 * `Icon` in `components/ui.tsx` for how these ligature names render).
 * Keys are this app's own vocabulary; values are the font's glyph names,
 * verified against the font's `.codepoints` manifest.
 */
export const ICONS = {
  calendar: 'calendar_month',
  check: 'check',
  list: 'list',
  home: 'home',
  door: 'door_front',
  doorOpen: 'door_open',
  garage: 'garage_door',
  garageOpen: 'garage_door_open',
  shades: 'blinds',
  thermometer: 'thermostat',
  battery: 'battery_full',
  batteryLow: 'battery_alert',
  droplet: 'water_drop',
  shield: 'shield',
  music: 'music_note',
  gear: 'settings',
  lock: 'lock',
  lockOpen: 'lock_open',
  alert: 'warning',
  bulb: 'lightbulb',
  toggle: 'toggle_on',
  power: 'power_settings_new',
  moon: 'bedtime',
  pencil: 'edit',
  star: 'star',
  gift: 'card_giftcard',
  plus: 'add',
  chevronLeft: 'chevron_left',
  chevronRight: 'chevron_right',
  chevronDown: 'expand_more',
  sync: 'sync',
  trash: 'delete',
  x: 'close',
  flame: 'local_fire_department',
  snow: 'ac_unit',
} as const;

export type IconName = keyof typeof ICONS;

export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
