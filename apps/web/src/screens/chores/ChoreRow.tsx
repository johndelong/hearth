import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/ui';
import { EASE, col, deep, soft } from '../../theme';

/**
 * One line on a chore board.
 *
 * The checkbox is its own large target, because checking off is the thing kids
 * do a dozen times a day and it should never require aim. Tapping the body
 * opens the chore's details in a modal instead of toggling it, so the two
 * actions can't be confused for one another.
 *
 * Bonus items add a left swipe that reveals a trash can; carrying the swipe the
 * full width of the row is itself the confirmation, so giving a job back never
 * needs a dialog.
 */

/** How far the row must travel before the trash can latches open. */
const REVEAL = 88;
/** Fraction of the row's width that counts as "swiped all the way". */
const COMMIT = 0.62;
/** Movement under this reads as a tap, not a drag. */
const SLOP = 8;

export function ChoreRow({
  title,
  sub,
  points,
  done,
  hue,
  night,
  busy,
  shimmer,
  onToggle,
  onOpen,
  onRemove,
}: {
  title: string;
  sub: string;
  points: number | null;
  done: boolean;
  hue: number;
  night: boolean;
  busy: boolean;
  shimmer: boolean;
  onToggle: () => void;
  onOpen: () => void;
  /** Bonus items only. Its absence is what makes a row un-swipeable. */
  onRemove?: () => void;
}) {
  const [dx, setDx] = useState(0);
  const [latched, setLatched] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const host = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);

  // A row that loses its swipe (or gets checked off) must not stay held open.
  useEffect(() => {
    if (!onRemove) {
      setDx(0);
      setLatched(false);
    }
  }, [onRemove]);

  const width = () => host.current?.offsetWidth ?? 320;

  const settle = () => {
    dragging.current = false;
    start.current = null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!onRemove || leaving) return;
    start.current = { x: e.clientX, y: e.clientY };
    dragging.current = false;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current || leaving) return;
    const moveX = e.clientX - start.current.x;
    const moveY = e.clientY - start.current.y;

    // Let a vertical scroll win outright — the board scrolls under these rows.
    if (!dragging.current) {
      if (Math.abs(moveY) > Math.abs(moveX)) {
        start.current = null;
        return;
      }
      if (Math.abs(moveX) < SLOP) return;
      dragging.current = true;
      host.current?.setPointerCapture?.(e.pointerId);
    }

    const base = latched ? -REVEAL : 0;
    // Rightward drag can close a latched row but never pulls past its resting edge.
    setDx(Math.min(0, base + moveX));
  };

  const onPointerUp = () => {
    if (!start.current && !dragging.current) return;
    const dragged = dragging.current;
    settle();
    if (!dragged) return;

    if (Math.abs(dx) >= width() * COMMIT) {
      // Swiped the whole way: that is the confirmation. Slide it out and go.
      setLeaving(true);
      setDx(-width());
      window.setTimeout(() => onRemove?.(), 190);
      return;
    }
    const open = Math.abs(dx) >= REVEAL / 2;
    setLatched(open);
    setDx(open ? -REVEAL : 0);
  };

  const swiping = dx !== 0;

  return (
    <div
      ref={host}
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 18,
        // Collapsing the row as it leaves keeps the list from jumping.
        maxHeight: leaving ? 0 : 400,
        opacity: leaving ? 0 : 1,
        marginBottom: leaving ? -7 : 0,
        transition: leaving ? `max-height .19s ${EASE}, opacity .19s ${EASE}, margin .19s ${EASE}` : undefined,
        touchAction: onRemove ? 'pan-y' : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* The trash can waiting underneath. Only ever built for bonus items. */}
      {onRemove && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingRight: 26,
            borderRadius: 18,
            background: col(25, night),
            color: night ? '#14161c' : '#fff',
          }}
        >
          <button
            type="button"
            aria-label={`Remove ${title}`}
            onClick={() => {
              setLeaving(true);
              setDx(-width());
              window.setTimeout(() => onRemove(), 190);
            }}
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 48,
              height: 48,
              border: 'none',
              borderRadius: 14,
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              // Untouchable until the swipe has actually revealed it.
              pointerEvents: latched ? 'auto' : 'none',
              opacity: Math.min(1, Math.abs(dx) / REVEAL),
            }}
          >
            <Icon name="trash" size={26} />
          </button>
        </div>
      )}

      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'stretch',
          gap: 4,
          borderRadius: 18,
          border: '1px solid var(--line)',
          background: done ? soft(hue, night) : 'var(--card)',
          transform: `translateX(${dx}px)`,
          transition: dragging.current ? undefined : `transform .22s ${EASE}`,
          opacity: busy ? 0.55 : 1,
        }}
      >
        {shimmer && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: '42%',
              borderRadius: 18,
              background: `linear-gradient(100deg, transparent, ${
                night ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.92)'
              }, transparent)`,
              animation: 'sheenSweep 1.25s ease-out both',
              pointerEvents: 'none',
            }}
          />
        )}

        {/*
          The checkbox is the whole left end of the row, not a 30px square
          floating inside it — a wall panel gets tapped by six-year-olds and by
          adults walking past with their hands full.
        */}
        <button
          type="button"
          aria-label={done ? `Uncheck ${title}` : `Check off ${title}`}
          aria-pressed={done}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            if (swiping) return;
            onToggle();
          }}
          style={{
            flex: 'none',
            display: 'grid',
            placeItems: 'center',
            width: 78,
            minHeight: 74,
            padding: 0,
            border: 'none',
            borderRadius: '18px 0 0 18px',
            background: 'transparent',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          <span
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 46,
              height: 46,
              borderRadius: 15,
              background: done ? col(hue, night) : 'var(--chip)',
              color: done ? (night ? '#14161c' : '#fff') : 'transparent',
              border: done ? 'none' : '2px solid var(--line)',
              transition: `background .25s ${EASE}, color .25s ${EASE}`,
              animation: done ? `popIn .36s cubic-bezier(.2,.9,.3,1.35) both` : undefined,
            }}
          >
            <Icon name="check" size={27} />
          </span>
        </button>

        <button
          type="button"
          aria-label={`Details for ${title}`}
          onClick={() => {
            if (swiping) {
              // A swipe that only latched the row shouldn't also open details.
              setDx(0);
              setLatched(false);
              return;
            }
            onOpen();
          }}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'block',
            padding: '13px 16px 13px 2px',
            border: 'none',
            borderRadius: '0 18px 18px 0',
            background: 'transparent',
            textAlign: 'left',
            cursor: 'pointer',
            color: 'inherit',
            font: 'inherit',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 17.5,
                fontWeight: 800,
                color: done ? deep(hue, night) : 'var(--ink)',
                textDecoration: done ? 'line-through' : 'none',
                opacity: done ? 0.72 : 1,
              }}
            >
              {title}
            </span>

            {points !== null && (
              <span
                style={{
                  flex: 'none',
                  padding: '3px 10px',
                  borderRadius: 999,
                  fontSize: 14,
                  fontWeight: 800,
                  background: soft(68, night),
                  color: deep(68, night),
                }}
              >
                +{points}
              </span>
            )}

          </span>

          <span style={{ display: 'block', fontSize: 13.5, color: 'var(--ink2)', marginTop: 2 }}>{sub}</span>
        </button>
      </div>
    </div>
  );
}
