import type { ReactNode } from 'react';
import { Button, Card, Icon, Switch, Tag, TapButton } from '../../components/ui';

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
    <Card
      padding="22px 24px 20px"
      delay={delay}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 600 }}>{title}</div>
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
    </Card>
  );
}

export function ToggleRow({
  label,
  sub,
  on,
  night,
  onChange,
}: {
  label: string;
  sub?: string;
  on: boolean;
  night?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div style={rowStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{label}</div>
        {sub && <div style={{ fontSize: 14.5, color: 'var(--ink2)', fontWeight: 600 }}>{sub}</div>}
      </div>
      <Switch on={on} night={night} onChange={onChange} label={label} />
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
          <Button key={String(option)} selected={on} onClick={() => onChange(option)}>
            {String(option)}
          </Button>
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
      {tag && <Tag style={tagStyle}>{tag}</Tag>}
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
