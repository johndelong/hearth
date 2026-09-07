import type { AvatarKey, Person, PointEvent, Streak } from '@dashboard/shared';
import { useEffect, useState } from 'react';
import { type PointLedger, api } from '../../api';
import { AvatarPicker, isAvatarKey } from '../../components/AvatarArt';
import { Field, GhostButton, Modal, PrimaryButton, fieldStyle } from '../../components/Modal';
import { Avatar, Button, Icon, TapButton } from '../../components/ui';
import { EASE, deep } from '../../theme';

/** What each kind of ledger entry is called in front of a parent. */
const LEDGER_KIND: Record<PointEvent['refType'], string> = {
  claim: 'Extra job',
  redemption: 'Reward claimed',
  manual: 'Manual adjustment',
  streak: 'Streak bonus',
};

/**
 * A person's profile: their balance and everything that has moved it,
 * newest first, opened by tapping their avatar on the Chores tab.
 *
 * Reading this history is a normal kid interaction, so the dialog itself
 * needs no PIN — only "Adjust points" does, via `onRequireUnlock`.
 */
export function ProfileDialog({
  person,
  streak,
  night,
  say,
  onRequireUnlock,
  onBoardChange,
  onPeopleChange,
  onClose,
}: {
  person: Person;
  streak: Streak | null;
  night: boolean;
  say: (text: string, hue?: number) => void;
  onRequireUnlock: (onReady: () => void) => void;
  onBoardChange: () => Promise<void>;
  onPeopleChange: () => Promise<void>;
  onClose: () => void;
}) {
  const [ledger, setLedger] = useState<PointLedger | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [adjusting, setAdjusting] = useState(false);
  const [streakBusy, setStreakBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const changeAvatar = async (avatarKey: AvatarKey | null) => {
    if (avatarBusy || avatarKey === person.avatarKey) return;
    setAvatarBusy(true);
    try {
      await api.updatePersonAvatar(person.id, avatarKey);
      await onPeopleChange();
    } catch (err) {
      say(err instanceof Error ? err.message : 'That did not save', 25);
    } finally {
      setAvatarBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    setStatus('loading');
    api
      .pointHistory(person.id)
      .then((data) => {
        if (!live) return;
        setLedger(data);
        setStatus('ready');
      })
      .catch(() => live && setStatus('error'));
    return () => {
      live = false;
    };
  }, [person.id]);

  /** Reports whether it saved, so the dialog stays open on a failure. */
  const adjust = async (delta: number, reason: string): Promise<boolean> => {
    try {
      const next = await api.adjustPoints(person.id, delta, reason || 'Manual adjustment');
      setLedger(next);
      setStatus('ready');
      // Every other balance on screen is the board's copy of this number.
      await onBoardChange();
      say(`${delta > 0 ? '+' : '−'}${Math.abs(delta)} for ${person.name}`, person.hue);
      return true;
    } catch (err) {
      say(err instanceof Error ? err.message : 'That did not save', 25);
      return false;
    }
  };

  const toggleStreak = () => {
    onRequireUnlock(() => {
      void (async () => {
        setStreakBusy(true);
        try {
          await api.setStreakPaused(person.id, !streak?.paused);
          await onBoardChange();
          say(streak?.paused ? `${person.name}'s streak resumes` : `${person.name}'s streak is frozen`, person.hue);
        } catch (err) {
          say(err instanceof Error ? err.message : 'That did not save', 25);
        } finally {
          setStreakBusy(false);
        }
      })();
    });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 91,
        background: 'rgba(10,12,20,.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 22,
        animation: 'fadeIn .22s ease both',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(94vw, 560px)',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: '22px 24px 20px',
          borderRadius: 30,
          background: 'var(--card)',
          boxShadow: '0 1px 2px rgba(20,24,40,.05),0 40px 80px -40px rgba(10,12,20,.6)',
          animation: `riseIn .34s ${EASE} both`,
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Avatar name={person.name} hue={person.hue} night={night} size={56} avatarUrl={person.avatarUrl} avatarKey={person.avatarKey} ring />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 27, fontWeight: 600, letterSpacing: '-.01em' }}>
              {person.name}
            </div>
            <div style={{ marginTop: 2, fontSize: 14, fontWeight: 800, color: 'var(--ink2)' }}>
              {status === 'ready' && ledger ? `${ledger.points} points saved up` : emptyNote(status)}
            </div>
          </div>

          {/* A streak lives beside the name it belongs to, not down with the
              ledger — freezing it has nothing to do with points. */}
          {person.onChores && (
            <Button
              variant={streak?.paused ? 'primary' : 'ghost'}
              size="sm"
              disabled={streakBusy}
              onClick={toggleStreak}
              title={
                streak?.paused
                  ? `Frozen at ${streak.length} in a row`
                  : streak?.length
                    ? `${streak.length} in a row`
                    : 'No streak yet'
              }
              style={{ flex: 'none', fontSize: 14.5 }}
            >
              <Icon name="moon" size={15} />
              {streak?.paused ? 'Resume' : 'Freeze'}
            </Button>
          )}

          <TapButton
            onClick={onClose}
            title="Close"
            style={{
              flex: 'none',
              width: 42,
              height: 42,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              background: 'var(--chip)',
              color: 'var(--ink2)',
            }}
          >
            <Icon name="x" size={17} />
          </TapButton>
        </header>

        {/* Picking a face is a normal kid interaction, not a parent one — no PIN gate here. */}
        <div style={{ opacity: avatarBusy ? 0.6 : 1 }}>
          <AvatarPicker
            value={isAvatarKey(person.avatarKey) ? person.avatarKey : null}
            name={person.name}
            hue={person.hue}
            night={night}
            onChange={(key) => void changeAvatar(key)}
          />
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>Points history</div>
              <div style={{ fontSize: 14.5, color: 'var(--ink2)', fontWeight: 600 }}>
                Every earn and spend, newest first
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={status !== 'ready'}
              onClick={() => onRequireUnlock(() => setAdjusting(true))}
              style={{ flex: 'none' }}
            >
              Adjust
            </Button>
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              border: '1px solid var(--line)',
              borderRadius: 18,
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 10,
                padding: '9px 14px',
                background: 'var(--chip)',
                position: 'sticky',
                top: 0,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink2)' }}>
                What
              </span>
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink2)' }}>
                Points
              </span>
            </div>

            {status !== 'ready' && (
              <div style={{ padding: '14px', color: 'var(--ink2)', fontWeight: 700 }}>{emptyNote(status)}</div>
            )}
            {status === 'ready' && ledger?.events.length === 0 && (
              <div style={{ padding: '14px', color: 'var(--ink2)', fontWeight: 700 }}>
                Nothing has moved {person.name}&rsquo;s points yet.
              </div>
            )}
            {status === 'ready' &&
              ledger?.events.map((event, i) => {
                const up = event.delta > 0;
                return (
                  <div
                    key={event.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      alignItems: 'center',
                      gap: 10,
                      padding: '11px 14px',
                      borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 800 }}>{event.reason}</div>
                      <div style={{ fontSize: 13.5, color: 'var(--ink2)', fontWeight: 600 }}>
                        {LEDGER_KIND[event.refType]} ·{' '}
                        <time dateTime={event.createdAt}>{stamp(event.createdAt)}</time>
                      </div>
                    </div>
                    <div
                      style={{
                        flex: 'none',
                        fontSize: 17,
                        fontWeight: 800,
                        color: up ? deep(148, night) : deep(25, night),
                      }}
                    >
                      {up ? '+' : '−'}
                      {Math.abs(event.delta)}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {adjusting && (
        <AdjustPointsDialog
          person={person}
          balance={ledger?.points ?? 0}
          night={night}
          onClose={() => setAdjusting(false)}
          onSave={adjust}
        />
      )}
    </div>
  );
}

function emptyNote(status: 'loading' | 'ready' | 'error'): string {
  if (status === 'error') return 'Could not load history';
  return 'Loading…';
}

/**
 * The manual adjustment, as a dialog.
 *
 * One signed number rather than an amount plus a direction: a parent taking
 * points away writes `-10`, which is also how it reads back on the ledger.
 */
function AdjustPointsDialog({
  person,
  balance,
  night,
  onClose,
  onSave,
}: {
  person: Person;
  balance: number;
  night: boolean;
  onClose: () => void;
  onSave: (delta: number, reason: string) => Promise<boolean>;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  // `-` on its own parses as NaN, which is what keeps Save disabled while
  // somebody is still typing the number after the sign.
  const delta = /^-?\d+$/.test(amount) ? Number(amount) : Number.NaN;
  const valid = Number.isInteger(delta) && delta !== 0;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    if (await onSave(delta, reason.trim())) onClose();
    else setSaving(false);
  };

  return (
    <Modal
      title={`Adjust ${person.name}'s points`}
      sub="A negative number takes points away"
      onClose={onClose}
      width={460}
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={() => void submit()} disabled={!valid || saving}>
            {saving ? 'Saving…' : 'Save adjustment'}
          </PrimaryButton>
        </>
      }
    >
      <Field label="Points" sub="For example 10, or -10 to take ten away">
        <input
          // `text`, not `number`: a number spinner on a wall tablet is a
          // three-pixel target, and it lets a stray `e` or `.` through.
          type="text"
          inputMode="text"
          autoComplete="off"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(signedDigits(e.target.value))}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          style={{ ...fieldStyle, fontSize: 22 }}
        />
      </Field>

      <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--ink2)' }}>
        {valid ? (
          <>
            {balance} → <span style={{ color: deep(delta > 0 ? 148 : 25, night) }}>{balance + delta}</span> pts
          </>
        ) : (
          <>Balance is {balance} pts</>
        )}
      </div>

      <Field label="Why" sub="Optional, but it is what makes the entry mean something later">
        <input
          type="text"
          placeholder="Manual adjustment"
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 200))}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          style={fieldStyle}
        />
      </Field>
    </Modal>
  );
}

/** Digits with at most one leading minus — anything else never reaches state. */
function signedDigits(raw: string): string {
  const negative = raw.trimStart().startsWith('-');
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  return digits || negative ? `${negative ? '-' : ''}${digits}` : '';
}

/** A ledger entry's moment, at the precision a parent actually reads. */
function stamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'Unknown date';
  return at.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: at.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
