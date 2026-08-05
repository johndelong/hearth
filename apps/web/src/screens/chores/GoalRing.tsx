import type { Person, Reward } from '@dashboard/shared';
import { useRef } from 'react';
import { Icon, TapButton } from '../../components/ui';
import { EASE, col, deep, soft } from '../../theme';

/**
 * The tappable progress ring beside a kid's name.
 *
 * A conic-gradient arc shows how close they are to their chosen prize, masked
 * into a ring so the prize's own art sits in the middle. Once they can afford
 * it the whole thing lifts and throws off sparks — the point is that a kid
 * glances at the board and knows.
 */
export function GoalRing({
  person,
  goal,
  points,
  night,
  onOpen,
}: {
  person: Person;
  goal: Reward | null;
  points: number;
  night: boolean;
  onOpen: () => void;
}) {
  const hue = person.hue;
  const accent = col(hue, night);
  const pct = goal ? Math.min(100, Math.round((points / Math.max(1, goal.cost)) * 100)) : 0;
  const reached = Boolean(goal && points >= goal.cost);

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
        width: 74,
        height: 74,
        padding: 0,
        borderRadius: '50%',
        background: 'transparent',
        transition: `transform .24s ${EASE}`,
        animation: reached ? 'cheerLift 2.4s ease-in-out infinite' : undefined,
      }}
    >
      {/* Progress arc, masked into a ring. */}
      <span
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          pointerEvents: 'none',
          background: goal
            ? `conic-gradient(from -90deg, ${accent} ${pct}%, var(--chip) 0)`
            : 'var(--chip)',
          WebkitMask: 'radial-gradient(circle at center, transparent 0 calc(50% - 6px), #000 calc(50% - 6px))',
          mask: 'radial-gradient(circle at center, transparent 0 calc(50% - 6px), #000 calc(50% - 6px))',
        }}
      />

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
          inset: 9,
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
          <span style={{ fontSize: 26, lineHeight: 1 }}>{goal.icon}</span>
        ) : (
          <Icon name={goal ? 'gift' : 'star'} size={23} />
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
