import type { Person, Reward } from '@dashboard/shared';
import { useRef } from 'react';
import { Icon, TapButton } from '../../components/ui';
import { EASE, col, deep, soft } from '../../theme';

/**
 * The tappable progress ring beside a kid's name.
 *
 * An arc shows how close they are to their chosen prize, drawn around the
 * prize's own art. Once they can afford it the whole thing lifts and throws
 * off sparks — the point is that a kid glances at the board and knows.
 */

/** Ring geometry, scaled from the design's 74px/6px-band reference. */
const REFERENCE_SIZE = 74;
const REFERENCE_RING_W = 6;

export function GoalRing({
  person,
  goal,
  points,
  night,
  onOpen,
  size = REFERENCE_SIZE,
}: {
  person: Person;
  goal: Reward | null;
  points: number;
  night: boolean;
  onOpen: () => void;
  /** Box size in px — matched to the avatar beside it so both line up. */
  size?: number;
}) {
  const hue = person.hue;
  const accent = col(hue, night);
  const pct = goal ? Math.min(100, Math.round((points / Math.max(1, goal.cost)) * 100)) : 0;
  const reached = Boolean(goal && points >= goal.cost);
  const scale = size / REFERENCE_SIZE;
  const ringW = REFERENCE_RING_W * scale;
  const center = size / 2;
  const ringR = center - ringW / 2;
  const ringC = 2 * Math.PI * ringR;
  const inset = 9 * scale;

  // Fixed positions so the sparks don't rearrange on every render.
  const sparks = useRef(
    [
      [4, 6],
      [74, 10],
      [42, -8],
      [88, 60],
      [12, 74],
      [60, 90],
    ] as const,
  ).current;
  const sparkHues = [hue, 62, 305, 148, hue + 30, 62];

  return (
    <TapButton
      onClick={onOpen}
      title={goal ? `${points} of ${goal.cost} toward ${goal.label}` : 'Pick a prize to save for'}
      style={{
        position: 'relative',
        flex: 'none',
        width: size,
        height: size,
        padding: 0,
        borderRadius: '50%',
        background: 'transparent',
        transition: `transform .24s ${EASE}`,
        animation: reached ? 'cheerLift 2.4s ease-in-out infinite' : undefined,
      }}
    >
      {/*
        Progress arc as an SVG ring. stroke-dashoffset is a plainly animatable
        property, so the arc eases to its new length when points land rather
        than snapping — which a conic-gradient cannot do without registering a
        custom property, and that proved unreliable to drive from React.
      */}
      <svg
        viewBox={`0 0 ${size} ${size}`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        aria-hidden="true"
      >
        <circle cx={center} cy={center} r={ringR} fill="none" stroke="var(--chip)" strokeWidth={ringW} />
        {goal && (
          <circle
            cx={center}
            cy={center}
            r={ringR}
            fill="none"
            stroke={accent}
            strokeWidth={ringW}
            strokeLinecap="round"
            strokeDasharray={ringC}
            strokeDashoffset={ringC * (1 - pct / 100)}
            transform={`rotate(-90 ${center} ${center})`}
            style={{ transition: `stroke-dashoffset .9s ${EASE}, stroke .4s ease` }}
          />
        )}
      </svg>

      {reached && (
        <span style={{ position: 'absolute', inset: -12, pointerEvents: 'none' }}>
          {sparks.map(([left, top], i) => (
            <span
              key={i}
              style={{
                position: 'absolute',
                left: `${left}%`,
                top: `${top}%`,
                width: 9,
                height: 9,
                borderRadius: 2,
                background: col(sparkHues[i]!, night),
                animation: `sparkle 1.8s ease-in-out ${(i * 0.24).toFixed(2)}s infinite`,
              }}
            />
          ))}
        </span>
      )}

      {/* The prize itself: photo, emoji, or the gift glyph. */}
      <span
        style={{
          position: 'absolute',
          inset,
          borderRadius: '50%',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: soft(305, night),
          color: deep(305, night),
        }}
      >
        {goal?.imageUrl ? (
          <img src={goal.imageUrl} alt={goal.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : goal?.icon ? (
          <span style={{ fontSize: 26 * scale, lineHeight: 1 }}>{goal.icon}</span>
        ) : (
          <Icon name={goal ? 'gift' : 'star'} size={23 * scale} />
        )}
      </span>
    </TapButton>
  );
}

/**
 * Confetti clipped to the card it belongs to. Positions are derived from a
 * seeded pseudo-random so a re-render mid-burst doesn't reshuffle the pieces.
 */
export function CardConfetti({ hue, night }: { hue: number; night: boolean }) {
  const bits = useRef(
    Array.from({ length: 54 }, (_, i) => {
      const rand = (n: number) => {
        const x = Math.sin((i + 1) * n) * 10000;
        return x - Math.floor(x);
      };
      const w = 5 + Math.round(rand(12.9898) * 5);
      return {
        left: rand(78.233) * 100,
        w,
        h: i % 3 ? w : Math.max(3, Math.round(w * 0.45)),
        round: i % 4 === 0,
        hue: [hue, hue + 34, hue - 26, 62, 148][i % 5]!,
        dur: 1.05 + rand(43.77) * 0.75,
        delay: rand(19.19) * 0.85,
      };
    }),
  ).current;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 26,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      {bits.map((b, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: `${b.left.toFixed(1)}%`,
            top: -14,
            width: b.w,
            height: b.h,
            borderRadius: b.round ? '50%' : 2,
            background: col(b.hue, night),
            animation: `cardConf ${b.dur.toFixed(2)}s linear ${b.delay.toFixed(2)}s both`,
          }}
        />
      ))}
    </div>
  );
}
