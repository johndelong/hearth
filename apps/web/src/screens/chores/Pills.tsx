import type { Streak } from '@dashboard/shared';
import { Icon } from '../../components/ui';
import { EASE, col, deep, soft } from '../../theme';

/**
 * The three things a glance at someone's card should answer: how far through
 * today they are, how long they've kept it up, and what they've banked.
 */

/** How many required chores are done today. Extra jobs are not counted. */
export function ProgressPill({
  done,
  total,
  night,
}: { done: number; total: number; night: boolean }) {
  const complete = total > 0 && done === total;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 12px',
        borderRadius: 999,
        fontSize: 14,
        fontWeight: 800,
        background: complete ? soft(148, night) : 'var(--chip)',
        color: complete ? deep(148, night) : 'var(--ink2)',
        transition: `background .4s ${EASE}, color .4s ${EASE}`,
      }}
    >
      <Icon name="check" size={14} />
      {done}/{total}
    </span>
  );
}

/**
 * Streak intensity.
 *
 * The colour walks from a cool ember to a hot one as the run grows, so a long
 * streak is legible across the kitchen without reading the number. The steps
 * are deliberately coarse — a kid should feel the jump when they reach one.
 */
const TIERS: Array<{ min: number; hue: number; label: string }> = [
  { min: 30, hue: 350, label: 'unstoppable' },
  { min: 14, hue: 25, label: 'on fire' },
  { min: 7, hue: 45, label: 'rolling' },
  { min: 3, hue: 68, label: 'warming up' },
  { min: 1, hue: 148, label: 'started' },
];

export function StreakPill({ streak, night }: { streak: Streak; night: boolean }) {
  if (streak.paused) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 12px',
          borderRadius: 999,
          fontSize: 14,
          fontWeight: 800,
          background: 'var(--chip)',
          color: 'var(--ink2)',
          opacity: 0.8,
        }}
        title={`Streak paused at ${streak.length}`}
      >
        <Icon name="moon" size={14} />
        {streak.length} · paused
      </span>
    );
  }

  // No tier at all is the zero state, and it stays on the card rather than
  // disappearing — a streak you cannot see is one you cannot be reminded of,
  // and an empty slot beside everyone else's flame reads as broken. Neutral
  // grey, the same way an unfinished ProgressPill says "not yet" rather than
  // saying anything worse.
  const tier = TIERS.find((t) => streak.length >= t.min) ?? null;
  // Past the top tier the pill keeps intensifying a little, so a 60-day run
  // still reads as more than a 30-day one.
  const heat = Math.min(1, streak.length / 30);

  return (
    <span
      title={tier ? `${streak.length} in a row — ${tier.label}` : 'No streak yet — finish today to start one'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 12px',
        borderRadius: 999,
        fontSize: 14,
        fontWeight: 800,
        background: tier ? soft(tier.hue, night) : 'var(--chip)',
        color: tier ? deep(tier.hue, night) : 'var(--ink2)',
        boxShadow:
          tier && heat > 0.4 ? `0 0 0 2px ${col(tier.hue, night)}${heat > 0.85 ? '' : '66'}` : 'none',
        transition: `background .5s ${EASE}, box-shadow .5s ${EASE}`,
        animation: streak.length >= 14 ? `ptsPop 2.6s ${EASE} infinite` : undefined,
      }}
    >
      <Icon name="flame" size={15} />
      {streak.length}
    </span>
  );
}
