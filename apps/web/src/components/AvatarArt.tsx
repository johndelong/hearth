import type { ReactNode } from 'react';

/**
 * The built-in avatar pack.
 *
 * Drawn here rather than fetched, because the panel has to work when the
 * internet is down and because an avatar service would mean a request per face
 * per render on a screen that stays open for weeks.
 *
 * Every face is a 64×64 flat composition with the same construction — a filled
 * ground, a head, two eyes on the same line — so they read as one set and stay
 * legible at 26px on a calendar chip as well as at 86px in the editor.
 *
 * The faces keep natural colours — a teal fox is nobody's idea of a fox — but
 * they sit on the person's colour, so a glance still says whose it is before
 * you have registered which animal it is.
 */

const INK = '#2f3038';

export const AVATAR_PACK = [
  'fox',
  'cat',
  'dog',
  'bear',
  'bunny',
  'panda',
  'owl',
  'frog',
  'penguin',
  'koala',
  'lion',
  'monkey',
] as const;

export type AvatarKey = (typeof AVATAR_PACK)[number];

export function isAvatarKey(value: unknown): value is AvatarKey {
  return typeof value === 'string' && (AVATAR_PACK as readonly string[]).includes(value);
}

/** Two eyes, always on the same line, so the set stays coherent. */
function Eyes({ y = 33, dx = 7, r = 2.7 }: { y?: number; dx?: number; r?: number }) {
  return (
    <>
      <circle cx={32 - dx} cy={y} r={r} fill={INK} />
      <circle cx={32 + dx} cy={y} r={r} fill={INK} />
    </>
  );
}

const PACK: Record<AvatarKey, { label: string; ground: string; art: ReactNode }> = {
  fox: {
    label: 'Fox',
    ground: '#ffeadb',
    art: (
      <>
        <path d="M13 26 L17 7 L31 17 Z" fill="#e2703a" />
        <path d="M51 26 L47 7 L33 17 Z" fill="#e2703a" />
        <path d="M16 23 L18 12 L27 18 Z" fill="#f7a072" />
        <path d="M48 23 L46 12 L37 18 Z" fill="#f7a072" />
        <ellipse cx="32" cy="33" rx="18" ry="16" fill="#f2833f" />
        <path d="M32 51 L20 37 Q32 33 44 37 Z" fill="#fff6ef" />
        <Eyes y={32} dx={8} />
        <ellipse cx="32" cy="42" rx="3" ry="2.4" fill={INK} />
      </>
    ),
  },

  cat: {
    label: 'Cat',
    ground: '#eceef6',
    art: (
      <>
        <path d="M14 25 L17 9 L30 17 Z" fill="#9aa0b4" />
        <path d="M50 25 L47 9 L34 17 Z" fill="#9aa0b4" />
        <path d="M17 22 L19 13 L26 18 Z" fill="#f2b8c6" />
        <path d="M47 22 L45 13 L38 18 Z" fill="#f2b8c6" />
        <circle cx="32" cy="34" r="17" fill="#aeb4c6" />
        <Eyes y={32} dx={7.5} />
        <path d="M32 40 l-3 -2.4 h6 Z" fill="#f2b8c6" />
        <path d="M14 36 h7 M14 41 h7 M50 36 h-7 M50 41 h-7" stroke={INK} strokeWidth="1.2" strokeLinecap="round" opacity=".55" />
      </>
    ),
  },

  dog: {
    label: 'Dog',
    ground: '#fdf0dc',
    art: (
      <>
        <ellipse cx="14" cy="34" rx="7" ry="13" fill="#8a5a3b" />
        <ellipse cx="50" cy="34" rx="7" ry="13" fill="#8a5a3b" />
        <circle cx="32" cy="33" r="17" fill="#c8925f" />
        <ellipse cx="32" cy="42" rx="10" ry="8" fill="#f5e2cb" />
        <Eyes y={31} dx={7.5} />
        <ellipse cx="32" cy="39" rx="3.4" ry="2.6" fill={INK} />
        <path d="M32 42 v4" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
      </>
    ),
  },

  bear: {
    label: 'Bear',
    ground: '#f6ece2',
    art: (
      <>
        <circle cx="16" cy="18" r="8" fill="#8b6242" />
        <circle cx="48" cy="18" r="8" fill="#8b6242" />
        <circle cx="16" cy="18" r="4" fill="#c99f7d" />
        <circle cx="48" cy="18" r="4" fill="#c99f7d" />
        <circle cx="32" cy="35" r="18" fill="#a3714c" />
        <ellipse cx="32" cy="43" rx="11" ry="8" fill="#e8d3bd" />
        <Eyes y={32} dx={8} />
        <ellipse cx="32" cy="40" rx="3.6" ry="2.8" fill={INK} />
      </>
    ),
  },

  bunny: {
    label: 'Bunny',
    ground: '#fdeef2',
    art: (
      <>
        <ellipse cx="24" cy="14" rx="5" ry="13" fill="#f0f0f4" />
        <ellipse cx="40" cy="14" rx="5" ry="13" fill="#f0f0f4" />
        <ellipse cx="24" cy="15" rx="2.4" ry="8.5" fill="#f4bfcd" />
        <ellipse cx="40" cy="15" rx="2.4" ry="8.5" fill="#f4bfcd" />
        <circle cx="32" cy="38" r="16" fill="#f7f7fa" />
        <Eyes y={36} dx={7} />
        <path d="M32 44 l-3 -2.4 h6 Z" fill="#e88ba3" />
        <path d="M32 44 v3" stroke={INK} strokeWidth="1.2" strokeLinecap="round" opacity=".6" />
      </>
    ),
  },

  panda: {
    label: 'Panda',
    ground: '#eef0f4',
    art: (
      <>
        <circle cx="16" cy="19" r="8" fill={INK} />
        <circle cx="48" cy="19" r="8" fill={INK} />
        <circle cx="32" cy="35" r="18" fill="#fbfbfd" />
        <ellipse cx="24" cy="32" rx="6" ry="7.5" fill={INK} transform="rotate(-14 24 32)" />
        <ellipse cx="40" cy="32" rx="6" ry="7.5" fill={INK} transform="rotate(14 40 32)" />
        <circle cx="24.5" cy="32" r="2.4" fill="#fbfbfd" />
        <circle cx="39.5" cy="32" r="2.4" fill="#fbfbfd" />
        <ellipse cx="32" cy="43" rx="3.6" ry="2.8" fill={INK} />
      </>
    ),
  },

  owl: {
    label: 'Owl',
    ground: '#e4f1f2',
    art: (
      <>
        <path d="M14 22 L20 10 L28 19 Z" fill="#4d7c86" />
        <path d="M50 22 L44 10 L36 19 Z" fill="#4d7c86" />
        <ellipse cx="32" cy="35" rx="18" ry="17" fill="#5d919c" />
        <circle cx="24" cy="31" r="8" fill="#f4fbfb" />
        <circle cx="40" cy="31" r="8" fill="#f4fbfb" />
        <circle cx="24" cy="31" r="3.4" fill={INK} />
        <circle cx="40" cy="31" r="3.4" fill={INK} />
        <path d="M32 36 l-3.4 4 h6.8 Z" fill="#f0a63c" />
        <path d="M22 46 q10 6 20 0" stroke="#4d7c86" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      </>
    ),
  },

  frog: {
    label: 'Frog',
    ground: '#e8f6e2',
    art: (
      <>
        <circle cx="21" cy="20" r="9" fill="#78bd5c" />
        <circle cx="43" cy="20" r="9" fill="#78bd5c" />
        <circle cx="21" cy="20" r="5" fill="#fbfff8" />
        <circle cx="43" cy="20" r="5" fill="#fbfff8" />
        <circle cx="21" cy="20.5" r="2.6" fill={INK} />
        <circle cx="43" cy="20.5" r="2.6" fill={INK} />
        <ellipse cx="32" cy="40" rx="18" ry="15" fill="#67ad4d" />
        <path d="M20 41 q12 10 24 0" stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" opacity=".75" />
        <circle cx="25" cy="35" r="1.5" fill={INK} opacity=".35" />
        <circle cx="39" cy="35" r="1.5" fill={INK} opacity=".35" />
      </>
    ),
  },

  penguin: {
    label: 'Penguin',
    ground: '#e3eef8',
    art: (
      <>
        <ellipse cx="32" cy="35" rx="18" ry="18" fill="#3b4356" />
        <ellipse cx="32" cy="39" rx="12" ry="14" fill="#fbfcfe" />
        <Eyes y={30} dx={6.5} r={2.5} />
        <path d="M32 35 l-4 3.6 h8 Z" fill="#f0a63c" />
        <path d="M12 40 q4 6 8 4" stroke="#3b4356" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M52 40 q-4 6 -8 4" stroke="#3b4356" strokeWidth="3" fill="none" strokeLinecap="round" />
      </>
    ),
  },

  koala: {
    label: 'Koala',
    ground: '#eef0f3',
    art: (
      <>
        <circle cx="13" cy="28" r="10" fill="#9aa4ae" />
        <circle cx="51" cy="28" r="10" fill="#9aa4ae" />
        <circle cx="13" cy="28" r="5.5" fill="#d6dce2" />
        <circle cx="51" cy="28" r="5.5" fill="#d6dce2" />
        <circle cx="32" cy="34" r="17" fill="#aab4be" />
        <Eyes y={31} dx={7.5} />
        <ellipse cx="32" cy="41" rx="5" ry="6" fill={INK} />
      </>
    ),
  },

  lion: {
    label: 'Lion',
    ground: '#fdf1da',
    art: (
      <>
        {Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2;
          return (
            <circle key={i} cx={32 + Math.cos(a) * 17} cy={34 + Math.sin(a) * 17} r="7.5" fill="#d99433" />
          );
        })}
        <circle cx="32" cy="34" r="16" fill="#f0b95c" />
        <Eyes y={32} dx={7} />
        <path d="M32 40 l-3.4 -2.8 h6.8 Z" fill={INK} />
        <path d="M32 40 v3.5 M32 43.5 q-3 2.5 -5.5 0 M32 43.5 q3 2.5 5.5 0" stroke={INK} strokeWidth="1.3" fill="none" strokeLinecap="round" />
      </>
    ),
  },

  monkey: {
    label: 'Monkey',
    ground: '#f7ede2',
    art: (
      <>
        <circle cx="13" cy="33" r="8" fill="#a5713f" />
        <circle cx="51" cy="33" r="8" fill="#a5713f" />
        <circle cx="13" cy="33" r="4" fill="#e2b98c" />
        <circle cx="51" cy="33" r="4" fill="#e2b98c" />
        <circle cx="32" cy="33" r="17" fill="#a5713f" />
        <ellipse cx="32" cy="38" rx="13" ry="12" fill="#e8c69c" />
        <path d="M19 27 q6 -7 13 -5 q7 -2 13 5" fill="#e8c69c" opacity=".85" />
        <Eyes y={32} dx={6.5} />
        <ellipse cx="28.5" cy="41" rx="1.4" ry="1.8" fill={INK} />
        <ellipse cx="35.5" cy="41" rx="1.4" ry="1.8" fill={INK} />
        <path d="M26 45 q6 4 12 0" stroke={INK} strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </>
    ),
  },
};

export const avatarLabel = (id: AvatarKey): string => PACK[id].label;

export function AvatarArt({
  id,
  size,
  ground,
}: {
  id: AvatarKey;
  size: number;
  /** Defaults to the face's own tone; callers pass the person's colour. */
  ground?: string;
}) {
  const face = PACK[id];
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={face.label}
      style={{ display: 'block' }}
    >
      <rect width="64" height="64" fill={ground ?? face.ground} />
      {face.art}
    </svg>
  );
}
