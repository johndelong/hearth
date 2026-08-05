import type { Chore, Person, Settings } from '@dashboard/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Board, api } from '../../api';
import { Avatar, Card, Icon, TapButton } from '../../components/ui';
import { EASE, col, deep, soft } from '../../theme';
import { CardConfetti, GoalRing } from './GoalRing';

interface Props {
  board: Board;
  people: Person[];
  settings: Settings;
  night: boolean;
  say: (text: string, hue?: number) => void;
  onBoardChange: (board: Board) => void;
  onEditChore: (chore: Chore) => void;
  onPickExtra: (person: Person) => void;
  onOpenCatalog: (person: Person) => void;
}

interface Row {
  kind: 'chore' | 'claim';
  id: string;
  title: string;
  /** Repeat rule for a chore; extra jobs show that they were claimed. */
  sub: string;
  /** Only extra jobs are worth points — chores are the baseline. */
  points: number | null;
  done: boolean;
}

export function ChoresScreen({
  board,
  people,
  settings,
  night,
  say,
  onBoardChange,
  onEditChore,
  onPickExtra,
  onOpenCatalog,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  /** Which card is throwing confetti, which row is shimmering, who just scored. */
  const [bursting, setBursting] = useState<string | null>(null);
  const [shimmer, setShimmer] = useState<string | null>(null);
  const [cheering, setCheering] = useState<string | null>(null);

  /**
   * One timer per effect. Restarting an effect has to cancel the previous
   * timer, or an earlier burst's expiry cuts the current one short — and two
   * kids clearing their boards seconds apart is the normal case, not the edge.
   */
  const timers = useRef<Record<string, number>>({});
  const restart = useCallback((key: string, ms: number, fn: () => void) => {
    window.clearTimeout(timers.current[key]);
    timers.current[key] = window.setTimeout(fn, ms);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of Object.values(pending)) window.clearTimeout(id);
    };
  }, []);

  /**
   * Extra jobs stay locked until the day's chores are done. `unlocked` tracks
   * who has cleared their chores so the button can pulse on the transition
   * rather than on every render.
   */
  const [justUnlocked, setJustUnlocked] = useState<string[]>([]);
  const wasUnlocked = useRef<Record<string, boolean>>({});

  const choresDoneFor = useCallback(
    (personId: string) => board.chores.filter((c) => c.personId === personId).every((c) => c.done),
    [board.chores],
  );

  useEffect(() => {
    const newlyUnlocked: string[] = [];
    for (const person of people) {
      if (!person.onChores || person.role === 'shared') continue;
      const open = choresDoneFor(person.id);
      // Only celebrate a board that actually had chores to finish.
      const hadChores = board.chores.some((c) => c.personId === person.id);
      if (open && hadChores && wasUnlocked.current[person.id] === false) newlyUnlocked.push(person.id);
      wasUnlocked.current[person.id] = open;
    }
    if (newlyUnlocked.length) {
      setJustUnlocked(newlyUnlocked);
      window.setTimeout(() => setJustUnlocked([]), 1600);
    }
  }, [people, board.chores, choresDoneFor]);

  const boards = useMemo(() => people.filter((p) => p.onChores && p.role !== 'shared'), [people]);

  const pointsFor = (personId: string) => board.points.find((p) => p.personId === personId)?.points ?? 0;

  const rowsFor = (personId: string): Row[] => [
    ...board.chores
      .filter((c) => c.personId === personId)
      .map((c) => ({
        kind: 'chore' as const,
        id: c.id,
        title: c.title,
        sub: c.repeat,
        points: null,
        done: c.done,
      })),
    ...board.claims
      .filter((c) => c.personId === personId)
      .map((c) => ({
        kind: 'claim' as const,
        id: c.id,
        title: c.title,
        sub: 'Extra job',
        points: c.points,
        done: c.done,
      })),
  ];

  const toggle = async (person: Person, row: Row) => {
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

    if (next) {
      // Every completed row gets the sweep of light.
      setShimmer(row.id);
      restart('shimmer', 1400, () => setShimmer(null));
      // Only extra jobs move points, so only they pop the pill.
      if (row.kind === 'claim') {
        setCheering(person.id);
        restart('cheer', 900, () => setCheering(null));
      }
    }

    try {
      const res =
        row.kind === 'chore' ? await api.setChoreDone(row.id, next) : await api.setClaimDone(row.id, next);
      onBoardChange({ ...optimistic, points: res.points });

      if (next) {
        const remaining = rowsFor(person.id).filter((r) => r.id !== row.id && !r.done).length;
        if (remaining === 0) {
          say(`${person.name} cleared the board!`, person.hue);
          if (settings.choreConfetti) {
            setBursting(person.id);
            restart('burst', 2700, () => setBursting(null));
          }
        } else if (row.points !== null) {
          say(`+${row.points} for ${person.name}`, person.hue);
        } else {
          say(`${row.title} — done`, person.hue);
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
        gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
        gap: 14,
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
          <Card
            key={person.id}
            padding="19px 19px 17px"
            delay={bi * 55}
            style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            {bursting === person.id && <CardConfetti hue={person.hue} night={night} />}

            <header style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
              <Avatar name={person.name} hue={person.hue} night={night} size={56} avatarUrl={person.avatarUrl} ring />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontFamily: 'Outfit',
                    fontSize: 21,
                    fontWeight: 600,
                    letterSpacing: '-.01em',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {person.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4, flexWrap: 'wrap' }}>
                  {isKid ? (
                    <span
                      style={{
                        padding: '3px 11px',
                        borderRadius: 999,
                        fontSize: 13.5,
                        fontWeight: 800,
                        background: soft(person.hue, night),
                        color: deep(person.hue, night),
                        animation: cheering === person.id ? `ptsPop .6s ${EASE} both` : undefined,
                      }}
                    >
                      {points} points
                    </span>
                  ) : (
                    <span
                      style={{
                        padding: '3px 11px',
                        borderRadius: 999,
                        fontSize: 13.5,
                        fontWeight: 800,
                        background: 'var(--chip)',
                        color: 'var(--ink2)',
                      }}
                    >
                      {rows.length - left} of {rows.length} done
                    </span>
                  )}
                </div>
              </div>

              {isKid && (
                <GoalRing
                  person={person}
                  goal={goal}
                  points={points}
                  night={night}
                  onOpen={() => onOpenCatalog(person)}
                />
              )}
            </header>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {rows.map((row) => (
                <TapButton
                  key={row.id}
                  onClick={() => void toggle(person, row)}
                  onHold={
                    row.kind === 'chore'
                      ? () => {
                          const chore = board.chores.find((c) => c.id === row.id);
                          if (chore) onEditChore(chore);
                        }
                      : undefined
                  }
                  disabled={busy === row.id}
                  style={{
                    position: 'relative',
                    overflow: 'hidden',
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
                  {shimmer === row.id && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: 0,
                        width: '42%',
                        background: `linear-gradient(100deg, transparent, ${
                          night ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.92)'
                        }, transparent)`,
                        animation: 'sheenSweep 1.25s ease-out both',
                        pointerEvents: 'none',
                      }}
                    />
                  )}

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

                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 17,
                        fontWeight: 800,
                        color: row.done ? deep(person.hue, night) : 'var(--ink)',
                        textDecoration: row.done ? 'line-through' : 'none',
                        opacity: row.done ? 0.72 : 1,
                      }}
                    >
                      {row.title}
                    </span>
                    <span style={{ display: 'block', fontSize: 13, color: 'var(--ink2)', marginTop: 1 }}>
                      {row.sub}
                    </span>
                  </span>

                  {isKid && row.points !== null && (
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

            {isKid && settings.claimExtras && (() => {
              const unlocked = choresDoneFor(person.id);
              return (
                <TapButton
                  onClick={() => unlocked && onPickExtra(person)}
                  disabled={!unlocked}
                  title={unlocked ? undefined : 'Finish your chores first'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: 11,
                    borderRadius: 16,
                    border: `1px dashed ${unlocked ? col(62, night) : 'var(--line)'}`,
                    color: unlocked ? deep(62, night) : 'var(--ink2)',
                    fontSize: 14.5,
                    fontWeight: 800,
                    opacity: unlocked ? 0.85 : 0.45,
                    transition: `opacity .4s ${EASE}, border-color .4s ${EASE}, color .4s ${EASE}`,
                    animation: justUnlocked.includes(person.id)
                      ? `unlockPulse 1.5s ${EASE} both`
                      : undefined,
                  }}
                >
                  <Icon name={unlocked ? 'star' : 'lock'} size={17} />
                  {unlocked ? 'Pick an extra job' : 'Finish your chores first'}
                </TapButton>
              );
            })()}
          </Card>
        );
      })}
    </div>
  );
}
