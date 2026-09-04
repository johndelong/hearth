import type { Person } from '@dashboard/shared';
import { Modal } from '../../components/Modal';
import { Button, Icon, Pill } from '../../components/ui';
import { deep, soft } from '../../theme';

/**
 * What a chore actually asks of you.
 *
 * Read-only on purpose: this is the board a kid uses, and the rules live behind
 * the PIN in Settings › Chores. The one action it offers is the same one the
 * row offers — check it off — so opening the details is never a dead end.
 */
export function ChoreDetails({
  title,
  frequency,
  description,
  instructions,
  points,
  done,
  person,
  night,
  readOnly,
  readOnlyHint,
  onToggle,
  onOverride,
  onClose,
}: {
  title: string;
  /** "Daily" for a chore; extra jobs say when they were picked up. */
  frequency: string;
  description: string | null;
  instructions: string | null;
  points: number | null;
  done: boolean;
  person: Person;
  night: boolean;
  readOnly?: boolean;
  /** Why it cannot be tapped — shown next to the override, so the ask makes sense. */
  readOnlyHint?: string;
  onToggle: () => void;
  /** A parent's PIN-gated way through `readOnly`, when there is one to offer. */
  onOverride?: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button size="lg" onClick={onClose}>
            Close
          </Button>
          {!readOnly && (
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                onToggle();
                onClose();
              }}
            >
              <Icon name="check" size={19} style={{ width: 'var(--icon-xs)', height: 'var(--icon-xs)' }} />
              {done ? 'Mark not done' : 'Check it off'}
            </Button>
          )}
          {readOnly && onOverride && (
            <Button size="lg" onClick={onOverride}>
              <Icon name="lock" size={17} style={{ width: 'var(--icon-xs)', height: 'var(--icon-xs)' }} />
              Override
            </Button>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: -4 }}>
        <Pill tone={{ background: soft(person.hue, night), color: deep(person.hue, night) }}>
          {person.name}
        </Pill>
        <Pill>{frequency}</Pill>
        {points !== null && (
          <Pill tone={{ background: soft(68, night), color: deep(68, night) }}>
            +{points} points
          </Pill>
        )}
        {done && (
          <Pill tone={{ background: soft(148, night), color: deep(148, night) }}>
            Done
          </Pill>
        )}
      </div>

      {readOnly && (
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--ink2)' }}>
          {readOnlyHint ?? 'This day is a record and cannot be changed.'}
        </div>
      )}

      <Section label="What it is" body={description} empty="No description yet." />
      <Section label="How to do it" body={instructions} empty="No special instructions for this one." />
    </Modal>
  );
}

function Section({ label, body, empty }: { label: string; body: string | null; empty: string }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 800, color: 'var(--ink2)', marginBottom: 6 }}>{label}</div>
      <div
        style={{
          fontSize: 'var(--text-lg)',
          fontWeight: 600,
          lineHeight: 1.5,
          // Instructions are typed as prose with line breaks; keep them.
          whiteSpace: 'pre-wrap',
          color: body ? 'var(--ink)' : 'var(--ink2)',
          opacity: body ? 1 : 0.75,
        }}
      >
        {body || empty}
      </div>
    </div>
  );
}
