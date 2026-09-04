import { Suspense, lazy, useState } from 'react';
import { Field, Modal, fieldStyle } from './Modal';
import { Icon, TapButton } from './ui';

// The full Unicode set behind the dialog is the single heaviest thing this
// app ships, so it loads as its own chunk rather than bloating every page
// load for a field only a parent editing rewards ever opens.
const EmojiPickerDialog = lazy(() => import('./EmojiPickerDialog'));

const triggerStyle = {
  ...fieldStyle,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  textAlign: 'left' as const,
};

/**
 * A field that opens the full Unicode emoji set rather than a fixed shortlist
 * — a reward's icon shouldn't be limited to whatever we thought to include.
 */
export function EmojiField({
  label,
  sub,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  sub?: string;
  value: string;
  placeholder: string;
  onChange: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Field label={label} sub={sub}>
        <TapButton onClick={() => setOpen(true)} style={triggerStyle}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 24, lineHeight: 1 }}>
              {value || <Icon name="gift" size={20} style={{ opacity: 0.4 }} />}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {value ? 'Tap to change' : placeholder}
            </span>
          </span>
          <Icon name="chevronDown" size={18} style={{ flex: 'none', opacity: 0.55 }} />
        </TapButton>
      </Field>
      {open && (
        <Suspense fallback={<Modal title="Choose an emoji" onClose={() => setOpen(false)}>Loading…</Modal>}>
          <EmojiPickerDialog
            onPick={(emoji) => {
              onChange(emoji);
              setOpen(false);
            }}
            onClear={value ? () => { onChange(''); setOpen(false); } : undefined}
            onCancel={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
