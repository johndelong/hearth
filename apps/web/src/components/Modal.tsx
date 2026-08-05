import type { CSSProperties, ReactNode } from 'react';
import { useEffect } from 'react';
import { CARD, EASE } from '../theme';

export function Modal({
  title,
  sub,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'rgba(10,12,20,.42)',
        backdropFilter: 'blur(3px)',
        animation: `fadeIn .22s ${EASE} both`,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
        style={{
          ...cardStyle,
          width: '100%',
          maxWidth: width,
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '26px 28px 6px' }}>
          <div style={{ fontFamily: 'Outfit', fontSize: 26, fontWeight: 600 }}>{title}</div>
          {sub && <div style={{ marginTop: 4, color: 'var(--ink2)', fontSize: 15.5 }}>{sub}</div>}
        </div>
        <div style={{ padding: '14px 28px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {children}
        </div>
        {footer && (
          <div
            style={{
              display: 'flex',
              gap: 12,
              justifyContent: 'flex-end',
              alignItems: 'center',
              padding: '16px 28px 24px',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

const cardStyle: CSSProperties = {
  background: 'var(--card)',
  borderRadius: 26,
  boxShadow: '0 1px 2px rgba(20,24,40,.05),0 30px 60px -30px rgba(20,24,40,.5)',
  animation: `riseIn .32s ${EASE} both`,
};

export const fieldStyle: CSSProperties = {
  width: '100%',
  minHeight: 56,
  padding: '14px 18px',
  borderRadius: 16,
  border: '1px solid var(--line)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 17,
  fontWeight: 700,
  outline: 'none',
};

export const labelStyle: CSSProperties = {
  fontSize: 14.5,
  fontWeight: 800,
  color: 'var(--ink2)',
  marginBottom: 6,
};

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </label>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 52,
        padding: '13px 28px',
        borderRadius: 999,
        border: 'none',
        background: 'var(--ink)',
        color: 'var(--card)',
        fontSize: 17,
        fontWeight: 800,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: 52,
        padding: '13px 24px',
        borderRadius: 999,
        border: '1px solid var(--line)',
        background: 'transparent',
        color: danger ? 'oklch(0.62 0.19 25)' : 'var(--ink2)',
        fontSize: 16.5,
        fontWeight: 800,
        cursor: 'pointer',
        marginRight: danger ? 'auto' : undefined,
      }}
    >
      {children}
    </button>
  );
}

export { CARD };
