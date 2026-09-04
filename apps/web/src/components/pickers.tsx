import type { Extra, Person, Reward } from '@dashboard/shared';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Field, GhostButton, Modal, PrimaryButton, fieldStyle } from './Modal';
import { Avatar, Button, Icon, TapButton } from './ui';
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

export interface PickerOption {
  id: string;
  label: string;
  /** An avatar, color swatch, or icon shown before the label — optional. */
  leading?: ReactNode;
}

const triggerStyle = {
  ...fieldStyle,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  textAlign: 'left' as const,
};

/** Marks a field as a picker rather than a plain text input, at a glance. */
function PickerChevron() {
  return <Icon name="chevronDown" size={18} style={{ flex: 'none', opacity: 0.55 }} />;
}

/**
 * A field that opens a dialog of tappable rows instead of a native `<select>`
 * or a full-width row of chips — the same choice, with room for an avatar
 * next to each option and a large touch target, while the field itself stays
 * one line tall. `PickerField` picks one; `MultiPickerField` picks any number.
 */
export function PickerField({
  label,
  sub,
  options,
  selected,
  placeholder,
  onChange,
}: {
  label: string;
  sub?: string;
  options: PickerOption[];
  selected: string | null;
  placeholder: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === selected);
  return (
    <>
      <Field label={label} sub={sub}>
        <TapButton onClick={() => setOpen(true)} style={triggerStyle}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {current?.leading}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {current?.label ?? placeholder}
            </span>
          </span>
          <PickerChevron />
        </TapButton>
      </Field>
      {open && (
        <PickerDialog
          title={label}
          options={options}
          selected={selected !== null ? [selected] : []}
          multiple={false}
          onCancel={() => setOpen(false)}
          onDone={(ids) => {
            if (ids[0]) onChange(ids[0]);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

export function MultiPickerField({
  label,
  sub,
  options,
  selected,
  placeholder,
  onChange,
}: {
  label: string;
  sub?: string;
  options: PickerOption[];
  selected: string[];
  placeholder: string;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.filter((o) => selected.includes(o.id));
  return (
    <>
      <Field label={label} sub={sub}>
        <TapButton onClick={() => setOpen(true)} style={triggerStyle}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {chosen.some((o) => o.leading) && (
              // Overlapping rather than a row, so five faces still fit on one
              // line instead of pushing the names off the edge of the field.
              <span style={{ display: 'flex', flex: 'none' }}>
                {chosen.map((o, i) => (
                  <span
                    key={o.id}
                    style={{
                      marginLeft: i === 0 ? 0 : -10,
                      borderRadius: '50%',
                      boxShadow: '0 0 0 2px var(--card)',
                    }}
                  >
                    {o.leading}
                  </span>
                ))}
              </span>
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {chosen.length ? chosen.map((o) => o.label).join(', ') : placeholder}
            </span>
          </span>
          <PickerChevron />
        </TapButton>
      </Field>
      {open && (
        <PickerDialog
          title={label}
          options={options}
          selected={selected}
          multiple
          onCancel={() => setOpen(false)}
          onDone={(ids) => {
            onChange(ids);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

/**
 * The dialog itself. A single-select tap picks and closes immediately, the
 * same snappiness as a native `<select>`; a multi-select tap toggles a draft
 * that only commits on Done, so a change mid-pick is still cancelable.
 */
function PickerDialog({
  title,
  options,
  selected,
  multiple,
  onCancel,
  onDone,
}: {
  title: string;
  options: PickerOption[];
  selected: string[];
  multiple: boolean;
  onCancel: () => void;
  onDone: (ids: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[]>(selected);

  const tap = (id: string) => {
    if (!multiple) {
      onDone([id]);
      return;
    }
    setDraft((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  return (
    <Modal
      title={title}
      onClose={onCancel}
      width={440}
      footer={
        multiple ? (
          <>
            <GhostButton onClick={onCancel}>Cancel</GhostButton>
            <PrimaryButton onClick={() => onDone(draft)}>Done</PrimaryButton>
          </>
        ) : (
          <GhostButton onClick={onCancel}>Cancel</GhostButton>
        )
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {options.map((opt) => {
          const on = multiple ? draft.includes(opt.id) : selected[0] === opt.id;
          return (
            <TapButton
              key={opt.id}
              onClick={() => tap(opt.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                minHeight: 58,
                padding: '10px 16px',
                borderRadius: 16,
                textAlign: 'left',
                background: on ? 'var(--chip)' : 'transparent',
              }}
            >
              {opt.leading}
              <span style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 700 }}>{opt.label}</span>
              {on && <Icon name="check" size={20} style={{ flex: 'none' }} />}
            </TapButton>
          );
        })}
        {options.length === 0 && (
          <div style={{ color: 'var(--ink2)', fontWeight: 700, padding: '8px 4px' }}>Nothing to pick from yet.</div>
        )}
      </div>
    </Modal>
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
