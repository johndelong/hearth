import emojiGroups from 'unicode-emoji-json/data-by-group.json';
import { useMemo, useState } from 'react';
import { GhostButton, Modal, fieldStyle } from './Modal';
import { TapButton } from './ui';

interface EmojiEntry {
  emoji: string;
  name: string;
}

interface EmojiGroup {
  name: string;
  slug: string;
  emojis: EmojiEntry[];
}

const GROUPS = emojiGroups as EmojiGroup[];
const ALL: EmojiEntry[] = GROUPS.flatMap((g) => g.emojis);

/**
 * The full Unicode emoji set, browsable by category or search — split into
 * its own chunk and loaded on demand, since the data behind it dwarfs
 * everything else this app ships on first load.
 */
export default function EmojiPickerDialog({
  onPick,
  onClear,
  onCancel,
}: {
  onPick: (emoji: string) => void;
  onClear?: () => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState(GROUPS[0]!.slug);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS.find((g) => g.slug === group)?.emojis ?? [];
    return ALL.filter((e) => e.name.includes(q));
  }, [query, group]);

  return (
    <Modal
      title="Choose an emoji"
      onClose={onCancel}
      width={520}
      footer={
        <>
          {onClear && <GhostButton onClick={onClear} danger>Remove icon</GhostButton>}
          <GhostButton onClick={onCancel}>Cancel</GhostButton>
        </>
      }
    >
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search emoji, like &ldquo;dog&rdquo; or &ldquo;star&rdquo;"
        autoFocus
        style={fieldStyle}
      />

      {!query && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {GROUPS.map((g) => (
            <TapButton
              key={g.slug}
              onClick={() => setGroup(g.slug)}
              style={{
                padding: '7px 13px',
                borderRadius: 999,
                fontSize: 13.5,
                fontWeight: 800,
                border: '1px solid var(--line)',
                background: group === g.slug ? 'var(--chip)' : 'transparent',
                color: group === g.slug ? 'var(--ink)' : 'var(--ink2)',
              }}
            >
              {g.name}
            </TapButton>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(46px, 1fr))',
          gap: 4,
          maxHeight: 320,
          overflowY: 'auto',
          padding: 2,
        }}
      >
        {shown.map((e) => (
          <TapButton
            key={e.emoji}
            title={e.name}
            onClick={() => onPick(e.emoji)}
            style={{ fontSize: 25, padding: '9px 0', borderRadius: 12, lineHeight: 1 }}
          >
            {e.emoji}
          </TapButton>
        ))}
        {shown.length === 0 && (
          <div style={{ gridColumn: '1 / -1', color: 'var(--ink2)', fontWeight: 700, padding: '10px 4px' }}>
            No emoji match &ldquo;{query}&rdquo;
          </div>
        )}
      </div>
    </Modal>
  );
}
