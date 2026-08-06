import type { CSSProperties, ReactNode } from 'react';
import { forwardRef, useEffect, useRef, useState } from 'react';
import { AVATAR_LIFT, CARD, EASE, ICONS, type IconName, col } from '../theme';
import { AvatarArt, isAvatarKey } from './AvatarArt';

export function Icon({
  name,
  size = 24,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: size, height: size, flex: 'none', ...style }}
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

/**
 * Round avatar, in order of preference: a photo, a face from the built-in
 * pack, then the person's initial. A photo outranks a pack face so that
 * picking one never quietly discards a photo somebody set.
 */
export function Avatar({
  name,
  hue,
  night,
  size = 40,
  avatarUrl,
  avatarKey,
  ring,
}: {
  name: string;
  hue: number;
  night: boolean;
  size?: number;
  avatarUrl?: string | null;
  avatarKey?: string | null;
  ring?: boolean;
}) {
  const base: CSSProperties = {
    flex: 'none',
    width: size,
    height: size,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    fontSize: size * 0.42,
    fontWeight: 800,
    background: col(hue, night),
    color: night ? '#14161c' : '#fff',
    // The ring is inset so it survives alongside the lift, which is not.
    boxShadow: ring ? `inset 0 0 0 2px ${col(hue, night)}, ${AVATAR_LIFT}` : AVATAR_LIFT,
  };
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} style={{ ...base, objectFit: 'cover' }} />;
  }
  if (isAvatarKey(avatarKey)) {
    return (
      <div style={{ ...base, background: 'transparent' }}>
        <AvatarArt id={avatarKey} size={size} ground={col(hue, night)} />
      </div>
    );
  }
  return <div style={base}>{(name || '?').trim().charAt(0).toUpperCase()}</div>;
}

/**
 * Touch targets on a wall panel are pressed by kids at odd angles, so buttons
 * get a visible press state rather than relying on hover.
 */
export function TapButton({
  children,
  onClick,
  onHold,
  style,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  onHold?: () => void;
  style?: CSSProperties;
  disabled?: boolean;
  title?: string;
}) {
  const [pressed, setPressed] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);

  const startHold = () => {
    setPressed(true);
    if (!onHold) return;
    held.current = false;
    holdTimer.current = window.setTimeout(() => {
      held.current = true;
      navigator.vibrate?.(12);
      onHold();
    }, 480);
  };

  const endHold = () => {
    setPressed(false);
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
  };

  useEffect(() => () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
  }, []);

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onPointerDown={startHold}
      onPointerUp={endHold}
      onPointerLeave={endHold}
      onPointerCancel={endHold}
      onContextMenu={(e) => {
        if (!onHold) return;
        e.preventDefault();
        onHold();
      }}
      onClick={() => {
        // Suppress the click that follows a long-press.
        if (held.current) {
          held.current = false;
          return;
        }
        onClick?.();
      }}
      style={{
        border: 'none',
        background: 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transform: pressed && !disabled ? 'scale(.97)' : 'none',
        transition: `transform .18s ${EASE}, opacity .2s ease`,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Toast({ toast }: { toast: { text: string; hue: number } | null }) {
  if (!toast) return null;
  return (
    <div
      key={toast.text + String(Date.now())}
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 38,
        zIndex: 120,
        padding: '14px 26px',
        borderRadius: 999,
        background: 'var(--card)',
        color: 'var(--ink)',
        fontSize: 17,
        fontWeight: 800,
        boxShadow: '0 8px 30px -10px rgba(20,24,40,.45)',
        borderLeft: `4px solid ${col(toast.hue, false)}`,
        animation: `toastIn 2.6s ${EASE} both`,
        pointerEvents: 'none',
      }}
    >
      {toast.text}
    </div>
  );
}

/** Full-screen confetti burst, used when a board is cleared. */
export function Confetti({ hues, big }: { hues: number[]; big?: boolean }) {
  const bits = useRef(
    Array.from({ length: big ? 70 : 44 }, (_, i) => {
      const palette = hues.filter((h) => h >= 0);
      const use = palette.length ? palette : [350, 258, 196, 148, 305, 45];
      return {
        hue: use[i % use.length]!,
        left: 2 + Math.random() * 96,
        w: 7 + Math.random() * 7,
        h: 9 + Math.random() * 10,
        square: i % 3 === 0,
        dur: 1.5 + Math.random() * 1.3,
        delay: Math.random() * 0.55,
      };
    }),
  ).current;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 95, pointerEvents: 'none', overflow: 'hidden' }}>
      {bits.map((b, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            top: -30,
            left: `${b.left}%`,
            width: b.w,
            height: b.h,
            borderRadius: b.square ? 2 : '50%',
            background: `oklch(0.72 0.16 ${b.hue})`,
            animation: `confFall ${b.dur}s cubic-bezier(.3,.5,.6,1) ${b.delay}s both`,
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Surfaces and controls
 *
 * Every rounded card, pill button, and toggle in the app comes from
 * here. Screens compose these rather than re-declaring padding, radius,
 * and color — so changing the look of a button is one edit, not thirty.
 * ------------------------------------------------------------------ */

/**
 * The standard raised panel: white surface, 26px radius, soft lift.
 * Forwards a ref because scrolling panes (the day view) need to reach the node.
 */
export const Card = forwardRef<
  HTMLDivElement,
  {
    children: ReactNode;
    style?: CSSProperties;
    padding?: number | string;
    /** Stagger for the rise-in entrance, in ms. Omit for no animation. */
    delay?: number;
  }
>(function Card({ children, style, padding = 0, delay }, ref) {
  return (
    <div
      ref={ref}
      style={{
        ...cardSurface,
        padding,
        ...(delay === undefined ? null : { animation: `riseIn .5s ${EASE} ${delay}ms both` }),
        ...style,
      }}
    >
      {children}
    </div>
  );
});

/** Parsed from the CARD token so the two can never drift apart. */
const cardSurface: CSSProperties = Object.fromEntries(
  CARD.split(';').map((rule) => {
    const [prop, ...rest] = rule.split(':');
    const name = prop!.trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    return [name, rest.join(':').trim()];
  }),
) as CSSProperties;

export type ButtonVariant = 'primary' | 'ghost' | 'quiet';
export type ButtonSize = 'sm' | 'md' | 'lg';

const SIZES: Record<ButtonSize, CSSProperties> = {
  sm: { minHeight: 46, padding: '11px 22px', fontSize: 16 },
  md: { minHeight: 50, padding: '12px 22px', fontSize: 16.5 },
  lg: { minHeight: 52, padding: '13px 26px', fontSize: 17 },
};

/**
 * The one pill button. `selected` flips any variant to the filled state
 * used by the view switchers, role pickers, and chip rows.
 */
export function Button({
  children,
  onClick,
  onHold,
  variant = 'ghost',
  size = 'md',
  selected = false,
  danger = false,
  disabled,
  title,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  onHold?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  selected?: boolean;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  style?: CSSProperties;
}) {
  const filled = selected || variant === 'primary';
  return (
    <TapButton
      onClick={onClick}
      onHold={onHold}
      disabled={disabled}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius: 999,
        fontWeight: 800,
        whiteSpace: 'nowrap',
        ...SIZES[size],
        background: filled ? 'var(--ink)' : 'transparent',
        color: danger ? 'oklch(0.62 0.19 25)' : filled ? 'var(--card)' : 'var(--ink2)',
        border: variant === 'quiet' || filled ? '1px solid transparent' : '1px solid var(--line)',
        transition: `all .25s ${EASE}`,
        ...style,
      }}
    >
      {children}
    </TapButton>
  );
}

/** Square icon-only button, sized to match the pill heights. */
export function IconButton({
  name,
  onClick,
  size = 'sm',
  title,
  style,
}: {
  name: IconName;
  onClick?: () => void;
  size?: ButtonSize;
  title?: string;
  style?: CSSProperties;
}) {
  const box = SIZES[size].minHeight as number;
  return (
    <TapButton
      onClick={onClick}
      title={title}
      style={{
        display: 'grid',
        placeItems: 'center',
        width: box,
        height: box,
        padding: 0,
        borderRadius: 999,
        border: '1px solid var(--line)',
        color: 'var(--ink2)',
        ...style,
      }}
    >
      <Icon name={name} size={22} />
    </TapButton>
  );
}

/** The on/off toggle used throughout Settings. */
export function Switch({
  on,
  onChange,
  night,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  night?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      style={{
        flex: 'none',
        position: 'relative',
        width: 66,
        height: 38,
        borderRadius: 999,
        border: on ? '1px solid transparent' : '1px solid var(--line)',
        padding: 0,
        cursor: 'pointer',
        background: on ? col(148, night ?? false) : 'var(--chip)',
        transition: `background .28s ${EASE}`,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 4,
          left: on ? 32 : 4,
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: night ? '#0f1116' : '#fff',
          boxShadow: '0 2px 5px rgba(20,24,40,.3)',
          transition: `left .28s ${EASE}`,
        }}
      />
    </button>
  );
}

/** Small rounded label — point values, counts, status. */
export function Tag({
  children,
  background,
  color,
  style,
}: {
  children: ReactNode;
  background?: string;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        flex: 'none',
        padding: '6px 13px',
        borderRadius: 999,
        fontFamily: 'Outfit',
        fontWeight: 600,
        fontSize: 16,
        background: background ?? 'var(--chip)',
        color: color ?? 'var(--ink2)',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
