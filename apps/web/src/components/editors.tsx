import {
  type Chore,
  type Extra,
  type Person,
  REPEATS,
  ROLES,
  type Reward,
  SWATCHES,
} from '@dashboard/shared';
import { useState } from 'react';
import { Field, GhostButton, Modal, PrimaryButton, fieldStyle } from './Modal';
import { Button, TapButton } from './ui';
import { col } from '../theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Accepts `8/31`, `8-31-2016`, or `Aug 31 2016`. Returns `[M-D, year]`. */
export function parseBday(text: string): [string | null, number | null] {
  const s = text.trim();
  if (!s) return [null, null];

  let month: number | null = null;
  let day: number | null = null;
  let year: number | null = null;

  const numeric = /^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{4}))?$/.exec(s);
  if (numeric) {
    month = Number(numeric[1]);
    day = Number(numeric[2]);
    year = numeric[3] ? Number(numeric[3]) : null;
  } else {
    const named = /^([a-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?$/i.exec(s);
    if (named) {
      const i = MONTHS.findIndex((m) => m.toLowerCase() === named[1]!.toLowerCase().slice(0, 3));
      if (i >= 0) {
        month = i + 1;
        day = Number(named[2]);
        year = named[3] ? Number(named[3]) : null;
      }
    }
  }

  if (!month || !day || month > 12 || day > 31) return [null, null];
  return [`${month}-${day}`, year];
}

export function formatBday(person: Person | null): string {
  if (!person?.bday) return '';
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(person.bday);
  if (!m) return '';
  return `${MONTHS[Number(m[1]) - 1]} ${m[2]}${person.byear ? ` ${person.byear}` : ''}`;
}

export function PersonEditor({
  person,
  night,
  onSave,
  onDelete,
  onClose,
}: {
  person: Person | null;
  night: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(person?.name ?? '');
  const [hue, setHue] = useState(person?.hue ?? 196);
  const [role, setRole] = useState<Person['role']>(person?.role ?? 'kid');
  const [bday, setBday] = useState(formatBday(person));
  const [avatarUrl, setAvatarUrl] = useState(person?.avatarUrl ?? '');

  const save = () => {
    const [parsed, year] = parseBday(bday);
    onSave({
      name: name.trim() || 'Someone',
      hue,
      role,
      bday: parsed,
      byear: year,
      avatarUrl: avatarUrl.trim() || null,
    });
  };

  return (
    <Modal
      title={person ? `Edit ${person.name}` : 'Add someone'}
      onClose={onClose}
      footer={
        <>
          {person && onDelete && <GhostButton onClick={onDelete} danger>Remove</GhostButton>}
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={!name.trim()}>Save</PrimaryButton>
        </>
      }
    >
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} autoFocus />
      </Field>

      <Field label="Color">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {SWATCHES.map(([label, swatch]) => (
            <TapButton
              key={label}
              title={label}
              onClick={() => setHue(swatch)}
              style={{
                width: 46,
                height: 46,
                borderRadius: '50%',
                background: col(swatch, night),
                boxShadow: hue === swatch ? '0 0 0 3px var(--ink)' : 'none',
              }}
            >
              {''}
            </TapButton>
          ))}
        </div>
      </Field>

      <Field label="Role">
        <div style={{ display: 'flex', gap: 10 }}>
          {ROLES.map((r) => (
            <Button
              key={r}
              size="lg"
              selected={role === r}
              onClick={() => setRole(r)}
              style={{ flex: 1, fontSize: 16.5, textTransform: 'capitalize' }}
            >
              {r}
            </Button>
          ))}
        </div>
      </Field>

      <Field label="Birthday (optional)">
        <input
          value={bday}
          onChange={(e) => setBday(e.target.value)}
          placeholder="Aug 31 2016"
          style={fieldStyle}
        />
      </Field>

      <Field label="Photo URL (optional)">
        <input
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          placeholder="https://…"
          style={fieldStyle}
        />
      </Field>
    </Modal>
  );
}

export function ChoreEditor({
  chore,
  people,
  onSave,
  onDelete,
  onClose,
}: {
  chore: Chore | null;
  people: Person[];
  onSave: (patch: Record<string, unknown>) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(chore?.title ?? '');
  const [personId, setPersonId] = useState(chore?.personId ?? people[0]?.id ?? '');
  const [repeat, setRepeat] = useState(chore?.repeat ?? 'Daily');
  const [points, setPoints] = useState(chore?.points ?? 5);

  return (
    <Modal
      title={chore ? 'Edit chore' : 'New chore'}
      onClose={onClose}
      footer={
        <>
          {chore && onDelete && <GhostButton onClick={onDelete} danger>Delete</GhostButton>}
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            onClick={() => onSave({ title: title.trim(), personId, repeat, points })}
            disabled={!title.trim() || !personId}
          >
            Save
          </PrimaryButton>
        </>
      }
    >
      <Field label="Chore">
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={fieldStyle} autoFocus />
      </Field>

      <Field label="Who">
        <select value={personId} onChange={(e) => setPersonId(e.target.value)} style={fieldStyle}>
          {people
            .filter((p) => p.role !== 'shared')
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </Field>

      <Field label="Repeats">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {REPEATS.map((r) => (
            <Button
              key={r}
              size="lg"
              selected={repeat === r}
              onClick={() => setRepeat(r)}
              style={{ flex: '1 1 120px', fontSize: 16 }}
            >
              {r}
            </Button>
          ))}
        </div>
      </Field>

      <Field label="Points">
        <input
          type="number"
          min={0}
          value={points}
          onChange={(e) => setPoints(Number(e.target.value))}
          style={fieldStyle}
        />
      </Field>
    </Modal>
  );
}

export function ExtraEditor({
  extra,
  onSave,
  onDelete,
  onClose,
}: {
  extra: Extra | { id?: string; title: string; points: number } | null;
  onSave: (patch: Record<string, unknown>) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(extra?.title ?? '');
  const [points, setPoints] = useState(extra?.points ?? 15);

  return (
    <Modal
      title={extra?.id ? 'Edit extra job' : 'New extra job'}
      onClose={onClose}
      footer={
        <>
          {extra?.id && onDelete && <GhostButton onClick={onDelete} danger>Delete</GhostButton>}
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={() => onSave({ title: title.trim(), points })} disabled={!title.trim()}>
            Save
          </PrimaryButton>
        </>
      }
    >
      <Field label="Job">
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={fieldStyle} autoFocus />
      </Field>
      <Field label="Points">
        <input
          type="number"
          min={0}
          value={points}
          onChange={(e) => setPoints(Number(e.target.value))}
          style={fieldStyle}
        />
      </Field>
    </Modal>
  );
}

export function RewardEditor({
  reward,
  onSave,
  onDelete,
  onClose,
}: {
  reward: Reward | { id?: string; label: string; cost: number } | null;
  onSave: (patch: Record<string, unknown>) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(reward?.label ?? '');
  const [cost, setCost] = useState(reward?.cost ?? 100);

  return (
    <Modal
      title={reward?.id ? 'Edit reward' : 'New reward'}
      onClose={onClose}
      footer={
        <>
          {reward?.id && onDelete && <GhostButton onClick={onDelete} danger>Delete</GhostButton>}
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={() => onSave({ label: label.trim(), cost })} disabled={!label.trim()}>
            Save
          </PrimaryButton>
        </>
      }
    >
      <Field label="Reward">
        <input value={label} onChange={(e) => setLabel(e.target.value)} style={fieldStyle} autoFocus />
      </Field>
      <Field label="Cost in points">
        <input
          type="number"
          min={0}
          value={cost}
          onChange={(e) => setCost(Number(e.target.value))}
          style={fieldStyle}
        />
      </Field>
    </Modal>
  );
}
