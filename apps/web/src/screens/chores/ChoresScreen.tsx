import type { Person, Settings } from '@dashboard/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Board, api } from '../../api';
import { Avatar, Card, Icon, TapButton } from '../../components/ui';
import { EASE, col, deep, soft } from '../../theme';
import { ChoreDetails } from './ChoreDetails';
import { ChoreRow } from './ChoreRow';
import { CardConfetti, GoalRing } from './GoalRing';
import { ProgressPill, StreakPill } from './Pills';

interface Props {
  board: Board;
  people: Person[];
  settings: Settings;
  night: boolean;
  say: (text: string, hue?: number) => void;
  onBoardChange: (board: Board) => void;
  onRemoveClaim: (claimId: string, person: Person) => void;
  onPickExtra: (person: Person) => void;
  onOpenCatalog: (person: Person) => void;
}

interface Row {
  kind: 'chore' | 'claim';
  /** The id the API wants: a chore id, or a claim id. */
  id: string;
  /**
   * Unique per board. A chore assigned to several people shares one id across
   * all of them, so anything tracking a single row — busy, shimmer, which modal
   * is open — has to key on the person too.
   */
  key: string;
  title: string;
  /** Repeat rule for a chore; extra jobs say so. Doubles as the modal's frequency. */
  sub: string;
  /** Shown when the row is tapped open. */
  description: string | null;
  instructions: string | null;
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
  onRemoveClaim,
  onPickExtra,
  onOpenCatalog,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * The row whose details modal is open, held by id rather than by value so
   * checking it off from inside the modal updates what the modal is showing.
   */
  const [opened, setOpened] = useState<{ personId: string; rowKey: string } | null>(null);
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
      if (!person.onChores) continue;
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

  const boards = useMemo(() => people.filter((p) => p.onChores), [people]);

  const pointsFor = (personId: string) => board.points.find((p) => p.personId === personId)?.points ?? 0;

  const rowsFor = (personId: string): Row[] => [
    ...board.chores
      .filter((c) => c.personId === personId)
      .map((c) => ({
        kind: 'chore' as const,
        id: c.choreId,
        key: `chore:${c.choreId}:${personId}`,
        title: c.title,
        sub: c.repeat,
        description: c.description,
        instructions: c.instructions,
        points: null,
        done: c.done,
      })),
    ...board.claims
      .filter((c) => c.personId === personId)
      .map((c) => ({
        kind: 'claim' as const,
        id: c.id,
        key: `claim:${c.id}`,
        title: c.title,
        sub: 'Extra job',
        description: c.description,
        instructions: c.instructions,
        points: c.points,
        done: c.done,
      })),
  ];

  const toggle = async (person: Person, row: Row) => {
    if (busy || board.readOnly) return;
    setBusy(row.key);
    const next = !row.done;

    // Optimistic: a kid tapping a chore should see it check off instantly.
    const optimistic: Board = {
      ...board,
      chores: board.chores.map((c) =>
        row.kind === 'chore' && c.choreId === row.id && c.personId === person.id ? { ...c, done: next } : c,
      ),
      claims: board.claims.map((c) => (row.kind === 'claim' && c.id === row.id ? { ...c, done: next } : c)),
    };
    onBoardChange(optimistic);

    if (next) {
      // Every completed row gets the sweep of light.
      setShimmer(row.key);
      restart('shimmer', 1400, () => setShimmer(null));
      // Only extra jobs move points, so only they pop the pill.
      if (row.kind === 'claim') {
        setCheering(person.id);
        restart('cheer', 900, () => setCheering(null));
      }
    }

    try {
      const res =
        row.kind === 'chore'
          ? await api.setChoreDone(row.id, person.id, next)
          : await api.setClaimDone(row.id, next);
      onBoardChange({ ...optimistic, points: res.points });

      if (next) {
        const remaining = rowsFor(person.id).filter((r) => r.key !== row.key && !r.done).length;
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

  // Resolved fresh each render so the modal follows the board, not a snapshot.
  const openedPerson = opened ? (boards.find((p) => p.id === opened.personId) ?? null) : null;
  const openedRow = openedPerson
    ? (rowsFor(openedPerson.id).find((r) => r.key === opened?.rowKey) ?? null)
    : null;

  return (
    <>
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
        const required = rows.filter((r) => r.kind === 'chore');
        const requiredTotal = required.length;
        const requiredDone = required.filter((r) => r.done).length;
        const points = pointsFor(person.id);
        const streak = board.streaks.find((s) => s.personId === person.id) ?? null;
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

            <header style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
              <Avatar name={person.name} hue={person.hue} night={night} size={56} avatarUrl={person.avatarUrl} avatarKey={person.avatarKey} ring />
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5, flexWrap: 'wrap' }}>
                  <ProgressPill done={requiredDone} total={requiredTotal} night={night} />
                  {streak && <StreakPill streak={streak} night={night} />}
                </div>
              </div>

              {/*
                Points sit under the goal ring and overlap it: what you've
                banked and what you're saving it for are one thought, so they
                read as one control rather than two pills in a row.
              */}
              {isKid && (
                <div style={{ flex: 'none', position: 'relative', paddingBottom: 13 }}>
                  <GoalRing
                    person={person}
                    goal={goal}
                    points={points}
                    night={night}
                    onOpen={() => onOpenCatalog(person)}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      left: '50%',
                      bottom: 0,
                      transform: 'translateX(-50%)',
                      padding: '3px 11px',
                      borderRadius: 999,
                      fontSize: 13.5,
                      fontWeight: 800,
                      whiteSpace: 'nowrap',
                      background: soft(person.hue, night),
                      color: deep(person.hue, night),
                      // Lifted off the ring it overlaps, so the arc reads behind it.
                      boxShadow: `0 0 0 3px var(--card)`,
                      animation: cheering === person.id ? `ptsPop .6s ${EASE} both` : undefined,
                    }}
                  >
                    {points} pts
                  </span>
                </div>
              )}
            </header>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {rows.map((row) => (
                <ChoreRow
                  key={row.key}
                  title={row.title}
                  sub={row.sub}
                  points={isKid ? row.points : null}
                  done={row.done}
                  hue={person.hue}
                  night={night}
                  busy={busy === row.key}
                  shimmer={shimmer === row.key}
                  readOnly={board.readOnly}
                  onToggle={() => void toggle(person, row)}
                  onOpen={() => setOpened({ personId: person.id, rowKey: row.key })}
                  onRemove={
                    row.kind === 'claim' && !board.readOnly
                      ? () => onRemoveClaim(row.id, person)
                      : undefined
                  }
                />
              ))}

              {rows.length === 0 && (
                <div style={{ padding: '10px 2px', color: 'var(--ink2)', fontWeight: 700 }}>
                  {board.today ? 'Nothing on the board today.' : 'Nothing was on the board that day.'}
                </div>
              )}
            </div>

            {isKid && settings.claimExtras && !board.readOnly && (() => {
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

    {openedPerson && openedRow && (
      <ChoreDetails
        title={openedRow.title}
        frequency={openedRow.sub}
        description={openedRow.description}
        instructions={openedRow.instructions}
        points={openedPerson.role === 'kid' ? openedRow.points : null}
        done={openedRow.done}
        person={openedPerson}
        night={night}
        readOnly={board.readOnly}
        onToggle={() => void toggle(openedPerson, openedRow)}
        onClose={() => setOpened(null)}
      />
    )}
    </>
  );
}
