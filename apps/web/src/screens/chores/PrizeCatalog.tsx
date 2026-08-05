import type { Person, Redemption, Reward } from '@dashboard/shared';
import { useEffect, useState } from 'react';
import { Avatar, Button, Icon, TapButton } from '../../components/ui';
import { EASE, col, deep, soft } from '../../theme';

/**
 * The prize catalog. Opened by tapping a kid's goal ring.
 *
 * Deliberately image-led: a kid should want the thing on the card. Each prize
 * shows what it costs, how close they are, and the two actions that matter —
 * take it now, or make it the thing they're saving for.
 */
export function PrizeCatalog({
  people,
  initialPersonId,
  rewards,
  redemptions,
  pointsFor,
  night,
  onRedeem,
  onSetGoal,
  onClose,
}: {
  people: Person[];
  initialPersonId: string;
  rewards: Reward[];
  redemptions: Redemption[];
  pointsFor: (personId: string) => number;
  night: boolean;
  onRedeem: (person: Person, reward: Reward) => void;
  onSetGoal: (person: Person, reward: Reward) => void;
  onClose: () => void;
}) {
  const kids = people.filter((p) => p.role === 'kid');
  const [personId, setPersonId] = useState(initialPersonId);
  const person = kids.find((p) => p.id === personId) ?? kids[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!person) return null;

  const points = pointsFor(person.id);
  const recent = redemptions.filter((r) => r.personId === person.id).slice(0, 4);

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
          width: 'min(96vw, 980px)',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: '22px 24px 20px',
          borderRadius: 30,
          background: 'var(--card)',
          boxShadow: '0 1px 2px rgba(20,24,40,.05),0 40px 80px -40px rgba(10,12,20,.6)',
          animation: `riseIn .34s ${EASE} both`,
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Avatar name={person.name} hue={person.hue} night={night} size={56} avatarUrl={person.avatarUrl} ring />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: 'Outfit', fontSize: 27, fontWeight: 600, letterSpacing: '-.01em' }}>
              {person.name}'s prizes
            </div>
            <div style={{ marginTop: 2, fontSize: 14, fontWeight: 800, color: 'var(--ink2)' }}>
              {points} points saved up
            </div>
          </div>
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

        {/* Switch between kids without closing the sheet. */}
        {kids.length > 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9 }}>
            {kids.map((kid) => {
              const on = kid.id === person.id;
              return (
                <TapButton
                  key={kid.id}
                  onClick={() => setPersonId(kid.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 14px 8px 8px',
                    borderRadius: 999,
                    border: on ? '1px solid transparent' : '1px solid var(--line)',
                    background: on ? soft(kid.hue, night) : 'transparent',
                    color: on ? deep(kid.hue, night) : 'var(--ink2)',
                  }}
                >
                  <Avatar name={kid.name} hue={kid.hue} night={night} size={30} avatarUrl={kid.avatarUrl} />
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}>
                    <span style={{ fontSize: 15, fontWeight: 800 }}>{kid.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, opacity: 0.7 }}>{pointsFor(kid.id)} pts</span>
                  </span>
                </TapButton>
              );
            })}
          </div>
        )}

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(212px, 1fr))',
            gridAutoRows: 'min-content',
            alignContent: 'start',
            gap: 16,
            padding: 2,
          }}
        >
          {rewards.map((reward) => {
            const affordable = points >= reward.cost;
            const pct = Math.min(100, Math.round((points / Math.max(1, reward.cost)) * 100));
            const isGoal = person.goalRewardId === reward.id;

            return (
              <div
                key={reward.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  borderRadius: 22,
                  overflow: 'hidden',
                  border: isGoal ? `2px solid ${col(person.hue, night)}` : '1px solid var(--line)',
                  background: 'var(--card)',
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    height: 124,
                    display: 'grid',
                    placeItems: 'center',
                    background: soft(305, night),
                    color: deep(305, night),
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: 10,
                      right: 10,
                      zIndex: 1,
                      padding: '4px 12px',
                      borderRadius: 999,
                      background: 'var(--card)',
                      color: 'var(--ink)',
                      fontSize: 14,
                      fontWeight: 800,
                      boxShadow: '0 2px 8px rgba(20,24,40,.18)',
                    }}
                  >
                    {reward.cost}
                  </span>
                  {reward.imageUrl ? (
                    <img
                      src={reward.imageUrl}
                      alt={reward.label}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : reward.icon ? (
                    <span style={{ fontSize: 54, lineHeight: 1 }}>{reward.icon}</span>
                  ) : (
                    <Icon name="gift" size={44} />
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '14px 15px 15px' }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink)' }}>{reward.label}</div>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 800,
                      color: affordable ? deep(148, night) : 'var(--ink2)',
                    }}
                  >
                    {affordable ? 'You can get this' : `${reward.cost - points} points to go`}
                  </div>

                  <div style={{ height: 7, borderRadius: 999, background: 'var(--chip)', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${pct}%`,
                        borderRadius: 999,
                        background: col(affordable ? 148 : person.hue, night),
                        animation: `growW .8s ${EASE} both`,
                      }}
                    />
                  </div>

                  <Button
                    size="sm"
                    variant={affordable ? 'primary' : 'quiet'}
                    disabled={!affordable}
                    onClick={() => onRedeem(person, reward)}
                    style={{
                      width: '100%',
                      fontSize: 15,
                      background: affordable ? 'var(--ink)' : 'var(--chip)',
                    }}
                  >
                    {affordable ? 'Redeem' : 'Keep saving'}
                  </Button>

                  <TapButton
                    onClick={() => onSetGoal(person, reward)}
                    style={{
                      width: '100%',
                      padding: '6px 4px',
                      fontSize: 13.5,
                      fontWeight: 800,
                      color: isGoal ? deep(person.hue, night) : 'var(--ink2)',
                      opacity: isGoal ? 1 : 0.75,
                    }}
                  >
                    {isGoal ? '★ My goal' : 'Make this my goal'}
                  </TapButton>
                </div>
              </div>
            );
          })}

          {rewards.length === 0 && (
            <div style={{ color: 'var(--ink2)', fontWeight: 700, padding: 8 }}>
              No prizes yet — add some in Settings › Chores.
            </div>
          )}
        </div>

        {recent.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 800,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: 'var(--ink2)',
              }}
            >
              Redeemed
            </span>
            {recent.map((r) => (
              <span
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 14px',
                  borderRadius: 999,
                  background: 'var(--chip)',
                  fontSize: 14,
                  fontWeight: 800,
                  color: 'var(--ink2)',
                }}
              >
                {r.label}
                <span style={{ opacity: 0.7 }}>−{r.cost} pts</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
