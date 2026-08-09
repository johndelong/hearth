import { useState } from 'react';
import { api } from '../api';
import { EASE } from '../theme';
import { Icon, TapButton } from './ui';

/**
 * The unlock gate for Settings. A wall panel has no keyboard, so this is a
 * keypad rather than a text field.
 */
export function PinPad({ onUnlocked, onCancel }: { onUnlocked: () => void; onCancel: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  const submit = async (pin: string) => {
    setChecking(true);
    try {
      await api.unlock(pin);
      onUnlocked();
    } catch {
      setError(true);
      setCode('');
      window.setTimeout(() => setError(false), 900);
    } finally {
      setChecking(false);
    }
  };

  const press = (key: string) => {
    if (checking) return;
    if (key === 'del') {
      setCode((c) => c.slice(0, -1));
      return;
    }
    const next = code + key;
    setCode(next);
    if (next.length > 8) return;
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 110,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(10,12,20,.55)',
        backdropFilter: 'blur(6px)',
        animation: `fadeIn .25s ${EASE} both`,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(92vw, 380px)',
          padding: '32px 30px 26px',
          borderRadius: 30,
          background: 'var(--card)',
          boxShadow: '0 30px 70px -30px rgba(10,12,20,.7)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 22,
          animation: `riseIn .3s ${EASE} both`,
          transform: error ? 'translateX(0)' : undefined,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 52,
              height: 52,
              borderRadius: 18,
              display: 'grid',
              placeItems: 'center',
              background: 'var(--chip)',
              color: 'var(--ink2)',
            }}
          >
            <Icon name="lock" size={24} />
          </span>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 600 }}>
            {error ? 'That PIN did not match' : 'Enter the parent PIN'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          {Array.from({ length: 8 }, (_, i) => (
            <span
              key={i}
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: i < code.length ? (error ? 'oklch(0.62 0.19 25)' : 'var(--ink)') : 'var(--chip)',
                transition: `background .2s ${EASE}`,
              }}
            />
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, width: '100%' }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'cancel', '0', 'del'].map((key) => {
            if (key === 'cancel') {
              return (
                <TapButton key={key} onClick={onCancel} style={{ ...keyStyle, fontSize: 15, color: 'var(--ink2)' }}>
                  Cancel
                </TapButton>
              );
            }
            if (key === 'del') {
              return (
                <TapButton key={key} onClick={() => press('del')} style={{ ...keyStyle, color: 'var(--ink2)' }}>
                  <Icon name="x" size={20} />
                </TapButton>
              );
            }
            return (
              <TapButton key={key} onClick={() => press(key)} style={keyStyle}>
                {key}
              </TapButton>
            );
          })}
        </div>
        <TapButton
          disabled={checking || code.length < 4}
          onClick={() => void submit(code)}
          style={{ ...keyStyle, width: '100%', minHeight: 54, background: 'var(--ink)', color: 'var(--card)' }}
        >
          {checking ? 'Checking…' : 'Unlock'}
        </TapButton>
      </div>
    </div>
  );
}

const keyStyle: React.CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  minHeight: 64,
  borderRadius: 20,
  background: 'var(--chip)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-display)',
  fontSize: 24,
  fontWeight: 600,
};
