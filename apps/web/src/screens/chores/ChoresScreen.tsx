import {
  DAY_NAMES,
  type Person,
  type Settings,
  TIMES_OF_DAY,
  TIME_OF_DAY_LABELS,
  type TimeOfDay,
  describeRecurrence,
  fromYmd,
} from '@dashboard/shared';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

/**
 * A quiet divider between parts of the day. Deliberately understated — it is
 * scaffolding for the eye, and must never compete with the chore rows or with
 * the person's name at the top of the card.
 */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        marginTop: 3,
        fontSize: 12.5,
        fontWeight: 800,
        letterSpacing: '.06em',
        textTransform: 'uppercase',
        color: 'var(--ink2)',
        opacity: 0.72,
      }}
    >
      {children}
      <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  );
}

/** Local today as `YYYY-MM-DD`, for the optimistic row. */
const todayYmd = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** "Sunday" — how a board being worked ahead refers to itself. */
const dayLabel = (ymd: string): string => DAY_NAMES[fromYmd(ymd).getDay()] ?? ymd;

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
  /** Which part of the day this row is filed under on the board. */
  section: TimeOfDay;
  title: string;
  /** Repeat rule for a chore; extra jobs say so. Doubles as the modal's frequency. */
  sub: string;
  /** Shown when the row is tapped open. */
  description: string | null;
  instructions: string | null;
  /** Only extra jobs are worth points — chores are the baseline. */
  points: number | null;
  /** Earned but not yet paid, because the day's chores are not finished. */
  pointsLocked: boolean;
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
   * Whether this person's required chores are all done — the gate on extra-job
   * points, used here only to guess right while the server catches up.
   */
  const choresDoneFor = useCallback(
    (personId: string) => board.chores.filter((c) => c.personId === personId).every((c) => c.done),
    [board.chores],
  );

  const boards = useMemo(() => people.filter((p) => p.onChores), [people]);

  const pointsFor = (personId: string) => board.points.find((p) => p.personId === personId)?.points ?? 0;

  const rowsFor = (personId: string): Row[] => [
    ...board.chores
      .filter((c) => c.personId === personId)
      .map((c) => ({
        kind: 'chore' as const,
        id: c.choreId,
        key: `chore:${c.choreId}:${personId}`,
        section: c.timeOfDay,
        title: c.title,
        // When a chore was ticked on a different day than the one it counts
        // for, that is the more useful thing to say about it than its rule.
        sub:
          c.completedOn && c.completedOn !== board.date
            ? `Done ${DAY_NAMES[fromYmd(c.completedOn).getDay()]}`
            : describeRecurrence(c.recurrence),
        description: c.description,
        instructions: c.instructions,
        points: null,
        pointsLocked: false,
        done: c.done,
      })),
    ...board.claims
      .filter((c) => c.personId === personId)
      .map((c) => ({
        kind: 'claim' as const,
        id: c.id,
        // Extra jobs are picked up whenever there is time for them, so they sit
        // with the unscoped chores rather than claiming a section of their own.
        key: `claim:${c.id}`,
        section: 'any' as TimeOfDay,
        title: c.title,
        sub: 'Extra job',
        description: c.description,
        instructions: c.instructions,
        points: c.points,
        pointsLocked: c.done && !c.paid,
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
        row.kind === 'chore' && c.choreId === row.id && c.personId === person.id
          ? { ...c, done: next, completedOn: next ? todayYmd() : null }
          : c,
      ),
      claims: board.claims.map((c) =>
        row.kind === 'claim' && c.id === row.id
          ? { ...c, done: next, paid: next && choresDoneFor(person.id) }
          : c,
      ),
    };
    onBoardChange(optimistic);

    if (next) {
      // Every completed row gets the sweep of light.
      setShimmer(row.key);
      restart('shimmer', 1400, () => setShimmer(null));
    }

    try {
      const res =
        row.kind === 'chore'
          ? await api.setChoreDone(row.id, person.id, next, board.today ? undefined : board.date)
          : await api.setClaimDone(row.id, next);
      onBoardChange({ ...optimistic, points: res.points });

      // What the ledger actually did. Finishing the last chore can pay out
      // several extra jobs at once, so the number that matters is the change in
      // the balance rather than the points on the row that was tapped.
      const before = board.points.find((p) => p.personId === person.id)?.points ?? 0;
      const after = res.points.find((p) => p.personId === person.id)?.points ?? 0;
      const gained = after - before;

      if (gained > 0) {
        setCheering(person.id);
        restart('cheer', 900, () => setCheering(null));
      }

      if (next) {
        const remaining = rowsFor(person.id).filter((r) => r.key !== row.key && !r.done).length;
        if (remaining === 0 && board.today) {
          say(`${person.name} cleared the board!`, person.hue);
          if (settings.choreConfetti) {
            setBursting(person.id);
            restart('burst', 2700, () => setBursting(null));
          }
        } else if (gained > 0) {
          say(`+${gained} for ${person.name}`, person.hue);
        } else if (board.today) {
          say(`${row.title} — done`, person.hue);
        } else {
          say(`${row.title} — done ahead for ${dayLabel(board.date)}`, person.hue);
        }
      }
    } catch (err) {
      onBoardChange(board); // roll back to what the server last confirmed
      say(err instanceof Error ? err.message : 'That did not save', 25);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Rows cut into the sections of the day, empty ones dropped.
   *
   * A board where nobody set a time comes back as a single unlabelled section,
   * which is the board exactly as it was before times existed — headers only
   * appear once there is more than one group for them to tell apart.
   */
  const sectionsFor = (rows: Row[]): Array<{ id: TimeOfDay; label: string | null; rows: Row[] }> => {
    const groups = TIMES_OF_DAY.map((id) => ({ id, rows: rows.filter((r) => r.section === id) })).filter(
      (g) => g.rows.length > 0,
    );
    const labelled = groups.length > 1;
    return groups.map((g) => ({ ...g, label: labelled ? TIME_OF_DAY_LABELS[g.id] : null }));
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
                  {/*
                    Two spans, because centring and the pop are both transforms
                    and an element only has one. Animating this directly makes
                    `ptsPop` replace the -50% centring — the pill slides half its
                    own width to the right for the duration, then snaps back the
                    moment the animation is taken off again. The outer span owns
                    the position, the inner one owns the motion.
                  */}
                  <span
                    style={{
                      position: 'absolute',
                      left: '50%',
                      bottom: 0,
                      transform: 'translateX(-50%)',
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
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
                  </span>
                </div>
              )}
            </header>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {sectionsFor(rows).map((section) => (
                <div key={section.id} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {section.label && <SectionLabel>{section.label}</SectionLabel>}
                  {section.rows.map((row) => (
                    <ChoreRow
                      key={row.key}
                      title={row.title}
                      sub={row.sub}
                      points={isKid ? row.points : null}
                      pointsLocked={row.pointsLocked}
                      done={row.done}
                      hue={person.hue}
                      night={night}
                      busy={busy === row.key}
                      shimmer={shimmer === row.key}
                      readOnly={board.readOnly}
                      readOnlyHint={
                        board.daysAhead > 0
                          ? 'Too far off — chores can be done up to a week ahead'
                          : 'This day is a record — it cannot be changed'
                      }
                      onToggle={() => void toggle(person, row)}
                      onOpen={() => setOpened({ personId: person.id, rowKey: row.key })}
                      onRemove={
                        row.kind === 'claim' && !board.readOnly
                          ? () => onRemoveClaim(row.id, person)
                          : undefined
                      }
                    />
                  ))}
                </div>
              ))}

              {rows.length === 0 && (
                <div style={{ padding: '10px 2px', color: 'var(--ink2)', fontWeight: 700 }}>
                  {board.today ? 'Nothing on the board today.' : 'Nothing was on the board that day.'}
                </div>
              )}
            </div>

            {/*
              Always available. An extra job can be picked up and finished at
              any hour — what waits on the day's chores is the payment, and the
              lock on the points pill says so where it is actually true.
            */}
            {isKid && settings.claimExtras && !board.readOnly && (
              <TapButton
                onClick={() => onPickExtra(person)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: 11,
                  borderRadius: 16,
                  border: `1px dashed ${col(68, night)}`,
                  color: deep(68, night),
                  fontSize: 14.5,
                  fontWeight: 800,
                  opacity: 0.85,
                }}
              >
                <Icon name="star" size={17} />
                Pick an extra job
              </TapButton>
            )}
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
