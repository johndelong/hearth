import type { Person } from '@dashboard/shared';
import type { ReactNode } from 'react';
import { Modal } from '../../components/Modal';
import { Button, Icon } from '../../components/ui';
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
  onToggle,
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
  onToggle: () => void;
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
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              onToggle();
              onClose();
            }}
          >
            <Icon name="check" size={19} />
            {done ? 'Mark not done' : 'Check it off'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: -4 }}>
        <Pill background={soft(person.hue, night)} color={deep(person.hue, night)}>
          {person.name}
        </Pill>
        <Pill background="var(--chip)" color="var(--ink2)">
          {frequency}
        </Pill>
        {points !== null && (
          <Pill background={soft(68, night)} color={deep(68, night)}>
            +{points} points
          </Pill>
        )}
        {done && (
          <Pill background={soft(148, night)} color={deep(148, night)}>
            Done
          </Pill>
        )}
      </div>

      <Section label="What it is" body={description} empty="No description yet." />
      <Section label="How to do it" body={instructions} empty="No special instructions for this one." />
    </Modal>
  );
}

function Section({ label, body, empty }: { label: string; body: string | null; empty: string }) {
  return (
    <div>
      <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--ink2)', marginBottom: 6 }}>{label}</div>
      <div
        style={{
          fontSize: 17,
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

function Pill({
  children,
  background,
  color,
}: { children: ReactNode; background: string; color: string }) {
  return (
    <span
      style={{
        padding: '5px 13px',
        borderRadius: 999,
        fontSize: 14.5,
        fontWeight: 800,
        background,
        color,
      }}
    >
      {children}
    </span>
  );
}
