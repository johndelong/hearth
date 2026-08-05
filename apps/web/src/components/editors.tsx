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
import { Avatar, Button, TapButton } from './ui';
import { col, deep, soft } from '../theme';

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
  night,
  onSave,
  onDelete,
  onClose,
}: {
  chore: Chore | null;
  people: Person[];
  night: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const assignable = people.filter((p) => p.role !== 'shared');
  const [title, setTitle] = useState(chore?.title ?? '');
  // A new chore starts on nobody; picking at least one is what enables Save.
  const [personIds, setPersonIds] = useState<string[]>(chore?.personIds ?? []);
  const [repeat, setRepeat] = useState(chore?.repeat ?? 'Daily');
  const [description, setDescription] = useState(chore?.description ?? '');
  const [instructions, setInstructions] = useState(chore?.instructions ?? '');

  return (
    <Modal
      title={chore ? 'Edit chore' : 'New chore'}
      onClose={onClose}
      footer={
        <>
          {chore && onDelete && <GhostButton onClick={onDelete} danger>Delete</GhostButton>}
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            onClick={() =>
              onSave({
                title: title.trim(),
                personIds,
                repeat,
                description: description.trim() || null,
                instructions: instructions.trim() || null,
              })
            }
            disabled={!title.trim() || personIds.length === 0}
          >
            Save
          </PrimaryButton>
        </>
      }
    >
      <Field label="Chore">
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={fieldStyle} autoFocus />
      </Field>

      <Field label="Who" sub="Pick everyone this chore belongs to — each gets their own checkbox">
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          {assignable.map((p) => {
            const on = personIds.includes(p.id);
            return (
              <TapButton
                key={p.id}
                onClick={() =>
                  setPersonIds((ids) => (on ? ids.filter((x) => x !== p.id) : [...ids, p.id]))
                }
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
                <Avatar name={p.name} hue={p.hue} night={night} size={34} avatarUrl={p.avatarUrl} />
                {p.name}
              </TapButton>
            );
          })}
        </div>
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

      <Field label="Description" sub="What this chore is, in a line">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Biscuit's breakfast, before school."
          style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.45 }}
        />
      </Field>

      <Field label="Special instructions" sub="How to do it — shown when they open the chore">
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
          placeholder={'Kibble is under the sink — one scoop.\nFresh water in the blue bowl.'}
          style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.45 }}
        />
      </Field>

      <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ink2)' }}>
        Chores are the everyday expectation and earn no points. Points come from
        extra jobs, which unlock once the day's chores are done.
      </p>
    </Modal>
  );
}

export function ExtraEditor({
  extra,
  onSave,
  onDelete,
  onClose,
}: {
  extra:
    | Extra
    | { id?: string; title: string; description?: string | null; instructions?: string | null; points: number }
    | null;
  onSave: (patch: Record<string, unknown>) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(extra?.title ?? '');
  const [points, setPoints] = useState(extra?.points ?? 15);
  const [description, setDescription] = useState(extra?.description ?? '');
  const [instructions, setInstructions] = useState(extra?.instructions ?? '');

  return (
    <Modal
      title={extra?.id ? 'Edit extra job' : 'New extra job'}
      onClose={onClose}
      footer={
        <>
          {extra?.id && onDelete && <GhostButton onClick={onDelete} danger>Delete</GhostButton>}
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            onClick={() =>
              onSave({
                title: title.trim(),
                points,
                description: description.trim() || null,
                instructions: instructions.trim() || null,
              })
            }
            disabled={!title.trim()}
          >
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
      <Field label="Description" sub="What this job is, in a line">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Take the recycling out to the curb."
          style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.45 }}
        />
      </Field>

      <Field label="Special instructions" sub="Travels with the job when a kid claims it">
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
          placeholder="Bag goes in the bin by the garage, not the curb."
          style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.45 }}
        />
      </Field>
    </Modal>
  );
}

/** A quick palette so a prize can be given a face without hunting for a URL. */
const PRIZE_ICONS = ['🍦', '🎬', '🛼', '🧪', '📓', '🎮', '🍕', '🎨', '🧸', '⚽', '🎧', '🚲', '🍪', '🎪'];

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
  const [icon, setIcon] = useState((reward as Reward | null)?.icon ?? '');
  const [imageUrl, setImageUrl] = useState((reward as Reward | null)?.imageUrl ?? '');

  return (
    <Modal
      title={reward?.id ? 'Edit reward' : 'New reward'}
      onClose={onClose}
      footer={
        <>
          {reward?.id && onDelete && <GhostButton onClick={onDelete} danger>Delete</GhostButton>}
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            onClick={() =>
              onSave({
                label: label.trim(),
                cost,
                icon: icon || null,
                imageUrl: imageUrl.trim() || null,
              })
            }
            disabled={!label.trim()}
          >
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

      <Field label="Icon">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {PRIZE_ICONS.map((choice) => (
            <TapButton
              key={choice}
              onClick={() => setIcon(icon === choice ? '' : choice)}
              style={{
                width: 52,
                height: 52,
                borderRadius: 16,
                fontSize: 26,
                lineHeight: 1,
                border: icon === choice ? '2px solid var(--ink)' : '1px solid var(--line)',
              }}
            >
              {choice}
            </TapButton>
          ))}
        </div>
      </Field>

      <Field label="Photo URL (optional — used instead of the icon)">
        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://…"
          style={fieldStyle}
        />
      </Field>
    </Modal>
  );
}
