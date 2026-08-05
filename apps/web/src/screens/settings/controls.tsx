import type { ReactNode } from 'react';
import { Icon, TapButton } from '../../components/ui';
import { EASE } from '../../theme';

export function Panel({
  title,
  sub,
  children,
  addLabel,
  onAdd,
  delay = 0,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
  addLabel?: string;
  onAdd?: () => void;
  delay?: number;
}) {
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '22px 24px 20px',
        borderRadius: 26,
        background: 'var(--card)',
        boxShadow: '0 1px 2px rgba(20,24,40,.05),0 16px 34px -22px rgba(20,24,40,.26)',
        animation: `riseIn .5s ${EASE} ${delay}ms both`,
      }}
    >
      <div>
        <div style={{ fontFamily: 'Outfit', fontSize: 21, fontWeight: 600 }}>{title}</div>
        {sub && <div style={{ marginTop: 3, fontSize: 15, color: 'var(--ink2)', fontWeight: 600 }}>{sub}</div>}
      </div>
      {children}
      {addLabel && onAdd && (
        <TapButton
          onClick={onAdd}
          style={{
            marginTop: 4,
            minHeight: 52,
            padding: 12,
            borderRadius: 16,
            border: '1.5px dashed var(--line)',
            color: 'var(--ink2)',
            fontSize: 15.5,
            fontWeight: 800,
            opacity: 0.75,
            width: '100%',
          }}
        >
          {addLabel}
        </TapButton>
      )}
    </section>
  );
}

export function Switch({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        flex: 'none',
        position: 'relative',
        width: 66,
        height: 38,
        borderRadius: 999,
        border: on ? '1px solid transparent' : '1px solid var(--line)',
        padding: 0,
        cursor: 'pointer',
        background: on ? 'oklch(0.68 0.14 148)' : 'var(--chip)',
        transition: `background .28s ${EASE}`,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 4,
          left: on ? 32 : 4,
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 2px 5px rgba(20,24,40,.3)',
          transition: `left .28s ${EASE}`,
        }}
      />
    </button>
  );
}

export function ToggleRow({
  label,
  sub,
  on,
  onChange,
}: {
  label: string;
  sub?: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div style={rowStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{label}</div>
        {sub && <div style={{ fontSize: 14.5, color: 'var(--ink2)', fontWeight: 600 }}>{sub}</div>}
      </div>
      <Switch on={on} onChange={onChange} />
    </div>
  );
}

export function ChipRow<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px 16px',
        flexWrap: 'wrap',
        minHeight: 72,
        padding: '14px 18px',
        borderRadius: 20,
        border: '1px solid var(--line)',
      }}
    >
      <div style={{ flex: 1, minWidth: 140, fontSize: 17, fontWeight: 800 }}>{label}</div>
      {options.map((option) => {
        const on = option === value;
        return (
          <TapButton
            key={String(option)}
            onClick={() => onChange(option)}
            style={{
              minHeight: 50,
              padding: '12px 22px',
              borderRadius: 999,
              border: on ? '1px solid transparent' : '1px solid var(--line)',
              background: on ? 'var(--ink)' : 'transparent',
              color: on ? 'var(--card)' : 'var(--ink2)',
              fontSize: 17,
              fontWeight: 800,
            }}
          >
            {String(option)}
          </TapButton>
        );
      })}
    </div>
  );
}

/** A tappable row with a trailing pill — used for extras, rewards, people. */
export function ItemRow({
  label,
  sub,
  tag,
  tagStyle,
  leading,
  onClick,
}: {
  label: string;
  sub?: string;
  tag?: string;
  tagStyle?: React.CSSProperties;
  leading?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <TapButton
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        minHeight: 56,
        padding: '12px 16px',
        borderRadius: 16,
        border: '1px solid var(--line)',
        textAlign: 'left',
      }}
    >
      {leading}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 17, fontWeight: 800, color: 'var(--ink)' }}>{label}</span>
        {sub && (
          <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--ink2)' }}>{sub}</span>
        )}
      </span>
      {tag && (
        <span
          style={{
            flex: 'none',
            padding: '6px 13px',
            borderRadius: 999,
            fontFamily: 'Outfit',
            fontWeight: 600,
            fontSize: 16,
            background: 'var(--chip)',
            color: 'var(--ink2)',
            ...tagStyle,
          }}
        >
          {tag}
        </span>
      )}
      <Icon name="pencil" size={18} style={{ opacity: 0.32, color: 'var(--ink2)' }} />
    </TapButton>
  );
}

export const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  minHeight: 72,
  padding: '15px 18px',
  borderRadius: 20,
  border: '1px solid var(--line)',
};
