import type { Extra, Person, Reward } from '@dashboard/shared';
import { GhostButton, Modal } from './Modal';
import { Avatar, Button, TapButton } from './ui';
import { col, deep, soft } from '../theme';

/**
 * Pick any number of people, as a row of tappable faces.
 *
 * Shared by the chore editor ("whose chore is this") and the event editor
 * ("who is going") — the same question, and it should not look like two
 * different controls depending on which screen asked it.
 */
export function PeoplePicker({
  people,
  selected,
  night,
  onChange,
}: {
  people: Person[];
  selected: string[];
  night: boolean;
  onChange: (personIds: string[]) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
      {people.map((p) => {
        const on = selected.includes(p.id);
        return (
          <TapButton
            key={p.id}
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((x) => x !== p.id) : [...selected, p.id])}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              minHeight: 52,
              padding: '8px 16px 8px 8px',
              borderRadius: 999,
              fontSize: 16.5,
              fontWeight: 800,
              border: `2px solid ${on ? col(p.hue, night) : 'var(--line)'}`,
              background: on ? soft(p.hue, night) : 'transparent',
              color: on ? deep(p.hue, night) : 'var(--ink2)',
            }}
          >
            <Avatar name={p.name} hue={p.hue} night={night} size={34} avatarUrl={p.avatarUrl} avatarKey={p.avatarKey} />
            {p.name}
          </TapButton>
        );
      })}
    </div>
  );
}

/** Kid-facing list of extra jobs they can pick up for points. */
export function ExtraPicker({
  person,
  extras,
  night,
  onPick,
  onClose,
}: {
  person: Person;
  extras: Extra[];
  night: boolean;
  onPick: (extra: Extra) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={`Extra jobs for ${person.name}`}
      sub="Pick one up and it lands on your board"
      onClose={onClose}
      footer={<GhostButton onClick={onClose}>Close</GhostButton>}
    >
      {extras.map((extra) => (
        <TapButton
          key={extra.id}
          onClick={() => onPick(extra)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            width: '100%',
            minHeight: 62,
            padding: '13px 18px',
            borderRadius: 18,
            border: '1px solid var(--line)',
            textAlign: 'left',
          }}
        >
          <span style={{ flex: 1, fontSize: 17.5, fontWeight: 800, color: 'var(--ink)' }}>{extra.title}</span>
          <span
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              background: soft(68, night),
              color: deep(68, night),
              fontSize: 16,
              fontWeight: 800,
            }}
          >
            +{extra.points}
          </span>
        </TapButton>
      ))}
      {extras.length === 0 && (
        <div style={{ color: 'var(--ink2)', fontWeight: 700 }}>No extra jobs are set up yet.</div>
      )}
    </Modal>
  );
}

export function RewardPicker({
  person,
  rewards,
  points,
  night,
  onRedeem,
  onSetGoal,
  onClose,
}: {
  person: Person;
  rewards: Reward[];
  points: number;
  night: boolean;
  onRedeem: (reward: Reward) => void;
  onSetGoal: (reward: Reward) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={`${person.name}'s rewards`}
      sub={`${points} points saved up · tap to redeem, or set one as a goal`}
      onClose={onClose}
      footer={<GhostButton onClick={onClose}>Close</GhostButton>}
    >
      {rewards.map((reward) => {
        const affordable = points >= reward.cost;
        const isGoal = person.goalRewardId === reward.id;
        return (
          <div
            key={reward.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              borderRadius: 18,
              border: isGoal ? '1px solid var(--ink)' : '1px solid var(--line)',
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 17.5, fontWeight: 800 }}>{reward.label}</span>
              <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: 'var(--ink2)' }}>
                {reward.cost} pts{isGoal ? ' · current goal' : ''}
              </span>
            </span>

            <Button
              size="sm"
              onClick={() => onSetGoal(reward)}
              style={{ flex: 'none', fontSize: 15 }}
            >
              {isGoal ? 'Goal' : 'Set goal'}
            </Button>

            <Button
              size="sm"
              variant={affordable ? 'primary' : 'quiet'}
              onClick={() => onRedeem(reward)}
              disabled={!affordable}
              style={{
                flex: 'none',
                fontSize: 15,
                background: affordable ? 'var(--ink)' : 'var(--chip)',
              }}
            >
              Redeem
            </Button>
          </div>
        );
      })}
      {rewards.length === 0 && (
        <div style={{ color: 'var(--ink2)', fontWeight: 700 }}>No rewards are set up yet.</div>
      )}
    </Modal>
  );
}
