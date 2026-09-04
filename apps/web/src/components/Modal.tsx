import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { EASE } from '../theme';
import { Button } from './ui';

/**
 * Every currently-mounted Modal, in the order they opened. A dialog opened
 * from inside another one's content (a picker's own dialog, say) has no way
 * to tell its parent it exists, so instead of trusting callers to track and
 * pass down "is something on top of me", each Modal registers itself here
 * and only the last one in the stack answers Escape or an outside click.
 */
let stack: symbol[] = [];

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
  const idRef = useRef<symbol>();
  if (!idRef.current) idRef.current = Symbol('modal');
  const titleId = useId();

  useEffect(() => {
    const id = idRef.current!;
    stack.push(id);
    const isTop = () => stack[stack.length - 1] === id;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])') ?? [])]
      .filter((node) => !node.hasAttribute('disabled'));
    (focusable()[0] ?? dialog)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return;
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
      stack = stack.filter((s) => s !== id);
      previous?.focus();
    };
  }, [onClose]);

  // Portaled to the document body rather than rendered where the JSX sits: a
  // picker field's own dialog can otherwise end up nested inside another
  // Modal's tree, and that Modal's backdrop-filter makes it a containing
  // block for `position: fixed` descendants — clipping the nested dialog's
  // overlay to the outer card's rounded box instead of the real viewport,
  // which is what painted dark triangles at its corners.
  return createPortal(
    <div
      onClick={() => stack[stack.length - 1] === idRef.current && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-6)',
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
        <div style={{ padding: 'var(--space-6) var(--space-7) var(--space-2)' }}>
          <div id={titleId} style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 600 }}>{title}</div>
          {sub && <div style={{ marginTop: 4, color: 'var(--ink2)', fontSize: 15.5 }}>{sub}</div>}
        </div>
        <div style={{ padding: 'var(--space-3) var(--space-7)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {children}
        </div>
        {footer && (
          <div
            style={{
              display: 'flex',
              gap: 12,
              justifyContent: 'flex-end',
              alignItems: 'center',
              padding: 'var(--space-4) var(--space-7) var(--space-6)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
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
  minHeight: 'calc(var(--control-lg) + var(--space-1))',
  padding: 'var(--space-3) var(--space-4)',
  borderRadius: 16,
  border: '1px solid var(--line)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 'var(--text-lg)',
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
