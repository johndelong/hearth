import type { Chore, Claim, Person, Reward, Settings } from '@dashboard/shared';
import { useMemo, useState } from 'react';
import { type Board, api } from '../../api';
import { Avatar, Icon, TapButton } from '../../components/ui';
import { EASE, col, deep, soft } from '../../theme';

interface Props {
  board: Board;
  people: Person[];
  settings: Settings;
  night: boolean;
  say: (text: string, hue?: number) => void;
  onBoardChange: (board: Board) => void;
  onCelebrate: (hues: number[]) => void;
  onEditChore: (chore: Chore) => void;
  onPickExtra: (person: Person) => void;
  onPickReward: (person: Person) => void;
}

export function ChoresScreen({
  board,
  people,
  settings,
  night,
  say,
  onBoardChange,
  onCelebrate,
  onEditChore,
  onPickExtra,
  onPickReward,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  const boards = useMemo(
    () => people.filter((p) => p.onChores && p.role !== 'shared'),
    [people],
  );

  const pointsFor = (personId: string) => board.points.find((p) => p.personId === personId)?.points ?? 0;

  const rowsFor = (personId: string): Array<{ kind: 'chore' | 'claim'; id: string; title: string; points: number; done: boolean }> => [
    ...board.chores
      .filter((c) => c.personId === personId)
      .map((c) => ({ kind: 'chore' as const, id: c.id, title: c.title, points: c.points, done: c.done })),
    ...board.claims
      .filter((c) => c.personId === personId)
      .map((c) => ({ kind: 'claim' as const, id: c.id, title: c.title, points: c.points, done: c.done })),
  ];

  const toggle = async (
    person: Person,
    row: { kind: 'chore' | 'claim'; id: string; title: string; points: number; done: boolean },
  ) => {
    if (busy) return;
    setBusy(row.id);
    const next = !row.done;

    // Optimistic: a kid tapping a chore should see it check off instantly.
    const optimistic: Board = {
      ...board,
      chores: board.chores.map((c) => (row.kind === 'chore' && c.id === row.id ? { ...c, done: next } : c)),
      claims: board.claims.map((c) => (row.kind === 'claim' && c.id === row.id ? { ...c, done: next } : c)),
    };
    onBoardChange(optimistic);

    try {
      const res =
        row.kind === 'chore'
          ? await api.setChoreDone(row.id, next)
          : await api.setClaimDone(row.id, next);
      onBoardChange({ ...optimistic, points: res.points });

      if (next) {
        const remaining = rowsFor(person.id).filter((r) => r.id !== row.id && !r.done).length;
        if (remaining === 0) {
          say(`${person.name} cleared the board!`, person.hue);
          if (settings.choreConfetti) onCelebrate([person.hue]);
        } else {
          say(`+${row.points ?? 0} for ${person.name}`, person.hue);
        }
      }
    } catch (err) {
      onBoardChange(board); // roll back to what the server last confirmed
      say(err instanceof Error ? err.message : 'That did not save', 25);
    } finally {
      setBusy(null);
    }
  };

  if (boards.length === 0) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--ink2)', fontWeight: 700 }}>
        No one has a chore board yet. Turn one on in Settings › Chores.
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${boards.length > 3 ? 260 : 300}px, 1fr))`,
        gap: 16,
        // Cards size to their own content instead of stretching to the tallest
        // board in the row.
        alignContent: 'start',
        alignItems: 'start',
        height: '100%',
        overflowY: 'auto',
        paddingBottom: 8,
      }}
    >
      {boards.map((person, bi) => {
        const rows = rowsFor(person.id);
        const left = rows.filter((r) => !r.done).length;
        const points = pointsFor(person.id);
        const goal = board.rewards.find((r) => r.id === person.goalRewardId) ?? null;
        const isKid = person.role === 'kid';

        return (
          <section
            key={person.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              padding: '20px 20px 18px',
              borderRadius: 26,
              background: 'var(--card)',
              boxShadow: '0 1px 2px rgba(20,24,40,.05),0 16px 34px -22px rgba(20,24,40,.26)',
              animation: `riseIn .5s ${EASE} ${bi * 60}ms both`,
            }}
          >
            <header style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
              <Avatar name={person.name} hue={person.hue} night={night} size={46} avatarUrl={person.avatarUrl} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: 'Outfit', fontSize: 22, fontWeight: 600 }}>{person.name}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink2)' }}>
                  {left ? `${left} to go` : 'All done'}
                  {isKid && ` · ${points} pts`}
                </div>
              </div>
              {left === 0 && rows.length > 0 && (
                <span
                  style={{
                    padding: '5px 12px',
                    borderRadius: 999,
                    background: soft(148, night),
                    color: deep(148, night),
                    fontSize: 13.5,
                    fontWeight: 800,
                  }}
                >
                  Done
                </span>
              )}
            </header>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {rows.map((row) => (
                <TapButton
                  key={row.id}
                  onClick={() => void toggle(person, row)}
                  onHold={row.kind === 'chore' ? () => {
                    const chore = board.chores.find((c) => c.id === row.id);
                    if (chore) onEditChore(chore);
                  } : undefined}
                  disabled={busy === row.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 13,
                    width: '100%',
                    minHeight: 62,
                    padding: '12px 15px',
                    borderRadius: 18,
                    border: '1px solid var(--line)',
                    background: row.done ? soft(person.hue, night) : 'transparent',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      flex: 'none',
                      width: 30,
                      height: 30,
                      borderRadius: 10,
                      display: 'grid',
                      placeItems: 'center',
                      background: row.done ? col(person.hue, night) : 'var(--chip)',
                      color: row.done ? (night ? '#14161c' : '#fff') : 'transparent',
                      transition: `background .25s ${EASE}`,
                    }}
                  >
                    <Icon name="check" size={19} />
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 17,
                      fontWeight: 800,
                      color: row.done ? deep(person.hue, night) : 'var(--ink)',
                      textDecoration: row.done ? 'line-through' : 'none',
                      opacity: row.done ? 0.72 : 1,
                    }}
                  >
                    {row.title}
                  </span>
                  {isKid && (
                    <span style={{ flex: 'none', fontSize: 14, fontWeight: 800, color: 'var(--ink2)' }}>
                      +{row.points}
                    </span>
                  )}
                </TapButton>
              ))}

              {rows.length === 0 && (
                <div style={{ padding: '10px 2px', color: 'var(--ink2)', fontWeight: 700 }}>
                  Nothing on the board today.
                </div>
              )}
            </div>

            {isKid && (
              <>
                {goal && <GoalBar goal={goal} points={points} hue={person.hue} night={night} />}
                <div style={{ display: 'flex', gap: 9, marginTop: 2 }}>
                  {settings.claimExtras && (
                    <TapButton onClick={() => onPickExtra(person)} style={pillStyle}>
                      <Icon name="plus" size={17} /> Extra job
                    </TapButton>
                  )}
                  <TapButton onClick={() => onPickReward(person)} style={pillStyle}>
                    <Icon name="gift" size={17} /> Rewards
                  </TapButton>
                </div>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

function GoalBar({ goal, points, hue, night }: { goal: Reward; points: number; hue: number; night: boolean }) {
  const pct = Math.min(100, Math.round((points / Math.max(1, goal.cost)) * 100));
  const reached = points >= goal.cost;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800, color: 'var(--ink2)' }}>
        <Icon name="star" size={16} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {goal.label}
        </span>
        <span>{reached ? 'Ready!' : `${points} / ${goal.cost}`}</span>
      </div>
      <div style={{ height: 10, borderRadius: 999, background: 'var(--chip)', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            borderRadius: 999,
            background: col(hue, night),
            animation: `growW .8s ${EASE} both`,
          }}
        />
      </div>
    </div>
  );
}

const pillStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  flex: 1,
  minHeight: 50,
  padding: '12px 16px',
  borderRadius: 999,
  border: '1px solid var(--line)',
  color: 'var(--ink2)',
  fontSize: 15.5,
  fontWeight: 800,
} as const;

export type { Claim };
