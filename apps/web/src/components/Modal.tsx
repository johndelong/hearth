import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { EASE } from '../theme';
import { Button } from './ui';

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])') ?? [])]
      .filter((node) => !node.hasAttribute('disabled'));
    (focusable()[0] ?? dialog)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const nodes = focusable();
        if (!nodes.length) return;
        const first = nodes[0]!;
        const last = nodes[nodes.length - 1]!;
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
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
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
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
          <div id={titleId} style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600 }}>{title}</div>
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

export function Field({
  label,
  sub,
  children,
}: { label: string; sub?: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ ...labelStyle, marginBottom: sub ? 2 : labelStyle.marginBottom }}>{label}</div>
      {sub && (
        <div style={{ marginBottom: 7, fontSize: 14, fontWeight: 600, color: 'var(--ink2)', opacity: 0.85 }}>
          {sub}
        </div>
      )}
      {children}
    </label>
  );
}

/** Modal footer actions — thin aliases so intent reads at the call site. */
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
    <Button variant="primary" size="lg" onClick={onClick} disabled={disabled}>
      {children}
    </Button>
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
    <Button
      size="lg"
      onClick={onClick}
      danger={danger}
      // A destructive action sits apart from confirm/cancel.
      style={danger ? { marginRight: 'auto' } : undefined}
    >
      {children}
    </Button>
  );
}
