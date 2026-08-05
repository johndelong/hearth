import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { EASE, ICONS, type IconName, col } from '../theme';

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

/** Round avatar. Falls back to the person's initial when there is no photo. */
export function Avatar({
  name,
  hue,
  night,
  size = 40,
  avatarUrl,
  ring,
}: {
  name: string;
  hue: number;
  night: boolean;
  size?: number;
  avatarUrl?: string | null;
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
    boxShadow: ring ? `inset 0 0 0 2px ${col(hue, night)}` : undefined,
  };
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} style={{ ...base, objectFit: 'cover' }} />;
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
