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

export const CARD =
  'background:var(--card);border-radius:26px;box-shadow:0 1px 2px rgba(20,24,40,.05),0 16px 34px -22px rgba(20,24,40,.26)';

/** CSS custom properties for the whole app, day or night. */
export function rootVars(night: boolean): Record<string, string> {
  return {
    '--bg': night ? '#12141a' : '#f4f5f8',
    '--card': night ? '#1d2029' : '#ffffff',
    '--ink': night ? '#eef0f6' : '#1e2230',
    '--ink2': night ? 'rgba(238,240,246,.6)' : 'rgba(30,34,48,.58)',
    '--line': night ? 'rgba(255,255,255,.09)' : 'rgba(30,34,48,.09)',
    '--chip': night ? 'rgba(255,255,255,.06)' : 'rgba(30,34,48,.05)',
  };
}

export const initialOf = (name: string): string => (name || '?').trim().charAt(0).toUpperCase();

/** Icon paths, drawn at 24×24 with a 1.8 stroke. */
export const ICONS = {
  calendar: 'M4 6.5h16v13H4zM4 11h16M8.5 3.5v4M15.5 3.5v4',
  check: 'M5 13l4 4L19 7',
  list: 'M5 7h14M5 12h14M5 17h9',
  home: 'M4 11l8-6.5 8 6.5v8.5H4z',
  gear: 'M4 7.5h9M17.5 7.5h2.5M4 16.5h3.5M12 16.5h8M15.5 5v5M10 14v5',
  lock: 'M7.5 10.5V8a4.5 4.5 0 019 0v2.5M5.5 10.5h13v9h-13z',
  alert: 'M12 4.5l8.5 15H3.5zM12 10v4.2M12 16.8h.02',
  bulb: 'M12 3.5a5.5 5.5 0 00-3 10.1v2.4h6v-2.4A5.5 5.5 0 0012 3.5zM10 20h4',
  moon: 'M20 14.2A8 8 0 1111.5 4a6.2 6.2 0 008.5 10.2z',
  pencil: 'M4.5 19.5l4-1L18 9l-3-3-9.5 9.5zM14 7l3 3',
  star: 'M12 4l2.4 5.1 5.6.7-4.1 3.9 1.1 5.5L12 16.5 6.9 19.2 8 13.7 3.9 9.8l5.6-.7z',
  gift: 'M4.5 10.5h15v9h-15zM4.5 10.5V8h15v2.5M12 8v11.5M12 8c-1.2-2.6-2.4-3.4-3.6-2.6C7.2 6.2 8 7.6 12 8M12 8c1.2-2.6 2.4-3.4 3.6-2.6 1.2.8.4 2.2-3.6 2.6',
  plus: 'M12 5v14M5 12h14',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  sync: 'M4 12a8 8 0 0113.7-5.7M20 12a8 8 0 01-13.7 5.7M17.5 3.5v3h-3M6.5 20.5v-3h3',
  trash: 'M5 7h14M10 7V5h4v2M6.5 7l1 12h9l1-12',
  x: 'M6 6l12 12M18 6L6 18',
  flame: 'M12 3c.6 3-1.2 4.2-2.6 5.6A6.3 6.3 0 007.5 13a4.5 4.5 0 009 0c0-1.7-.8-2.9-1.7-3.9-.7-.8-1.2-1.6-1-2.6-1 .5-1.8 1.4-2 2.4-.9-1.2-1-3.2.2-5.9z',
} as const;

export type IconName = keyof typeof ICONS;

export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
