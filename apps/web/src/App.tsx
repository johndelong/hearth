import type { CalendarEvent, Chore, Extra, Person, Reward, WeekStart } from '@dashboard/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from './api';
import { EventEditor } from './components/EventEditor';
import { IdleFrame } from './components/IdleFrame';
import { PinPad } from './components/PinPad';
import { UpdateToast, useVersionWatch } from './components/UpdateNotice';
import { ChoreEditor, ExtraEditor, PersonEditor, RewardEditor } from './components/editors';
import { ExtraPicker } from './components/pickers';
import { Button, Confetti, Icon, IconButton, TapButton, Toast } from './components/ui';
import { CalendarScreen } from './screens/calendar/CalendarScreen';
import type { CalView } from './screens/calendar/useEvents';
import { rangeFor, useEvents } from './screens/calendar/useEvents';
import { ChoresScreen } from './screens/chores/ChoresScreen';
import { PrizeCatalog } from './screens/chores/PrizeCatalog';
import { SettingsScreen, type SettingsSection } from './screens/settings/SettingsScreen';
import { type Tab, useAppData, useClock, useIdle, useNight, useToast } from './state';
import { EASE, type IconName, MONTHS_LONG, rootVars } from './theme';

type Editor =
  | { kind: 'person'; person: Person | null }
  | { kind: 'chore'; chore: Chore | null }
  | { kind: 'extra'; extra: Extra | { id?: string; title: string; points: number } | null }
  | { kind: 'reward'; reward: Reward | { id?: string; label: string; cost: number } | null }
  | { kind: 'event'; event: CalendarEvent | null }
  | { kind: 'pickExtra'; person: Person }
  | { kind: 'catalog'; person: Person }
  | null;

export default function App() {
  const data = useAppData();
  const { people, settings, board } = data;
  const night = useNight(settings.theme);
  const now = useClock();
  const [idle, poke] = useIdle(settings.idleMin);
  const [toast, say] = useToast();
  // Reloads itself when idle; prompts when someone is using the panel.
  const version = useVersionWatch(idle);

  const [tab, setTab] = useState<Tab>('today');
  const [calView, setCalView] = useState<CalView>('day');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [section, setSection] = useState<SettingsSection>('family');
  const [editor, setEditor] = useState<Editor>(null);
  const [confetti, setConfetti] = useState<number[] | null>(null);
  const [unlocked, setUnlocked] = useState(true);
  const [pinPrompt, setPinPrompt] = useState(false);
  const [calendarNonce, setCalendarNonce] = useState(0);

  // Frame mode needs today's events regardless of which tab is open.
  const idleEvents = useEvents('day', now, settings.weekStart);

  /**
   * The day the header names: whatever the open tab is pointed at. Each tab
   * keeps its own place, so switching between them does not quietly drag the
   * other one along.
   */
  const viewing = useMemo(() => {
    if (tab === 'chores' && board?.date) return new Date(`${board.date}T00:00:00`);
    if (tab === 'today') return anchor;
    return now;
  }, [tab, board?.date, anchor, now]);

  /**
   * What the header actually reads. A single day is named by its date; a week
   * or a month is named by the month, the way macOS Calendar does it, because
   * picking one day out of a grid of thirty to put in the title is arbitrary.
   */
  const heading = useMemo(() => {
    if (tab === 'today' && calView !== 'day') return spanLabel(calView, anchor, settings.weekStart);
    return {
      title: viewing.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        // Only worth the width once the year is no longer the obvious one.
        ...(viewing.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
      }),
      sub: viewing.toLocaleDateString('en-US', { weekday: 'long' }),
    };
  }, [tab, calView, anchor, settings.weekStart, viewing, now]);

  useEffect(() => {
    void api
      .session()
      .then((s) => setUnlocked(s.unlocked))
      .catch(() => undefined);
  }, []);

  // Coming back from frame mode should feel like a fresh start.
  useEffect(() => {
    if (!idle) return;
    setEditor(null);
    setAnchor(new Date());
  }, [idle]);

  const celebrate = useCallback((hues: number[]) => {
    setConfetti(hues);
    window.setTimeout(() => setConfetti(null), 3200);
  }, []);

  /** Settings is the one tab that can be locked behind the parent PIN. */
  const openSettings = () => {
    if (settings.pinSet && !unlocked) {
      setPinPrompt(true);
      return;
    }
    setTab('settings');
  };

  // Only today's board can have anything "left" — a past day is a record.
  const openChores = useMemo(() => {
    if (!board?.today) return 0;
    const onBoard = new Set(people.filter((p) => p.onChores).map((p) => p.id));
    return (
      board.chores.filter((c) => !c.done && onBoard.has(c.personId)).length +
      board.claims.filter((c) => !c.done && onBoard.has(c.personId)).length
    );
  }, [board, people]);

  const tabs: Array<{ id: Tab; label: string; icon: IconName; badge: number }> = [
    { id: 'today', label: 'Calendar', icon: 'calendar', badge: 0 },
    { id: 'chores', label: 'Chores', icon: 'check', badge: openChores },
    { id: 'settings', label: 'Settings', icon: 'gear', badge: 0 },
  ];

  if (data.loading) {
    return <Splash text="Waking up…" night={night} />;
  }
  if (data.error) {
    return <Splash text={data.error} night={night} tone="error" />;
  }

  const isSidebar = settings.navModel === 'sidebar';

  return (
    <div
      onPointerDown={poke}
      onPointerMove={poke}
      style={{
        ...rootVars(night),
        background: 'var(--bg)',
        color: 'var(--ink)',
        height: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: isSidebar ? 'row' : 'column',
        transition: 'background .9s ease, color .9s ease',
      }}
    >
      {isSidebar && (
        <nav
          style={{
            width: 112,
            flex: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 5,
            padding: '16px 0 18px',
            background: 'var(--card)',
            borderRight: '1px solid var(--line)',
          }}
        >
          {tabs.map((t) => (
            <NavButton
              key={t.id}
              {...t}
              active={tab === t.id}
              rail
              onClick={() => (t.id === 'settings' ? openSettings() : setTab(t.id))}
            />
          ))}
        </nav>
      )}

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            flexWrap: 'wrap',
            padding: '22px 30px 14px',
          }}
        >
          {/*
            Whichever day is being looked at, on every tab — the arrows below
            move this, and `Today` brings it back. A wall panel is glanced at
            far more often than it is used, and "which day am I looking at" is
            what that glance is usually for.
          */}
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <h1 style={{ margin: 0, fontFamily: 'Outfit', fontSize: 34, fontWeight: 600, lineHeight: 1.1 }}>
              {heading.title}
            </h1>
            <div style={{ marginTop: 3, fontSize: 16.5, fontWeight: 700, color: 'var(--ink2)' }}>
              {heading.sub}
            </div>
          </div>

          {tab === 'today' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <IconButton name="chevronLeft" title="Previous" onClick={() => setAnchor((a) => shift(a, calView, -1))} />
                <Button size="sm" onClick={() => setAnchor(new Date())} style={{ fontSize: 15.5 }}>
                  Today
                </Button>
                <IconButton name="chevronRight" title="Next" onClick={() => setAnchor((a) => shift(a, calView, 1))} />
              </div>

              <div style={{ display: 'flex', gap: 4, padding: 5, borderRadius: 999, background: 'var(--chip)' }}>
                {(['day', 'week', 'month'] as const).map((v) => (
                  <Button
                    key={v}
                    variant="quiet"
                    onClick={() => setCalView(v)}
                    style={{
                      minHeight: 0,
                      padding: '9px 20px',
                      fontSize: 15.5,
                      textTransform: 'capitalize',
                      // Selected reads as a raised chip, not a filled pill.
                      background: calView === v ? 'var(--card)' : 'transparent',
                      color: calView === v ? 'var(--ink)' : 'var(--ink2)',
                      boxShadow: calView === v ? '0 2px 6px rgba(20,24,40,.14)' : 'none',
                    }}
                  >
                    {v}
                  </Button>
                ))}
              </div>

              <Button
                variant="primary"
                size="sm"
                onClick={() => setEditor({ kind: 'event', event: null })}
              >
                <Icon name="plus" size={18} /> Add
              </Button>
            </>
          )}
          {tab === 'chores' && board && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <IconButton
                  name="chevronLeft"
                  title="Previous day"
                  onClick={() => data.setBoardDate(shiftDay(board.date, -1))}
                />
                <Button
                  size="sm"
                  onClick={() => data.setBoardDate(null)}
                  selected={!board.today}
                  style={{ fontSize: 15.5 }}
                >
                  Today
                </Button>
                <IconButton
                  name="chevronRight"
                  title="Next day"
                  onClick={() => data.setBoardDate(shiftDay(board.date, 1))}
                />
              </div>

              {/*
                Which day it is now lives in the header, so this only has to say
                which direction you have gone — and on a future board that is
                also the hint that the rows can still be tapped.
              */}
              {!board.today && (
                <span
                  style={{
                    padding: '7px 15px',
                    borderRadius: 999,
                    background: 'var(--chip)',
                    fontSize: 15,
                    fontWeight: 800,
                    color: 'var(--ink2)',
                  }}
                >
                  {dayDirection(board.date) === 'past' ? 'Looking back' : 'Coming up'}
                </span>
              )}
            </div>
          )}
        </header>

        <div style={{ flex: 1, minHeight: 0, padding: '6px 30px 24px' }}>
          {tab === 'today' && (
            <CalendarScreen
              key={calendarNonce}
              view={calView}
              anchor={anchor}
              now={now}
              people={people}
              settings={settings}
              night={night}
              onEditEvent={(event) => setEditor({ kind: 'event', event })}
            />
          )}

          {tab === 'chores' && board && (
            <ChoresScreen
              board={board}
              people={people}
              settings={settings}
              night={night}
              say={say}
              onBoardChange={data.setBoard}
              onRemoveClaim={(claimId, person) => {
                void (async () => {
                  try {
                    await api.deleteClaim(claimId);
                    await data.reloadBoard();
                    say(`Back on the list for ${person.name}`, person.hue);
                  } catch (err) {
                    say(err instanceof Error ? err.message : 'That did not save', 25);
                  }
                })();
              }}
              onPickExtra={(person) => setEditor({ kind: 'pickExtra', person })}
              onOpenCatalog={(person) => setEditor({ kind: 'catalog', person })}
            />
          )}

          {tab === 'settings' && board && (
            <SettingsScreen
              section={section}
              onSection={setSection}
              people={people}
              settings={settings}
              board={board}
              night={night}
              say={say}
              onSettingsChange={data.setSettings}
              onPeopleChange={data.reloadPeople}
              onBoardChange={data.reloadBoard}
              onEditPerson={(person) => setEditor({ kind: 'person', person })}
              onEditChore={(chore) => setEditor({ kind: 'chore', chore })}
              onEditExtra={(extra) => setEditor({ kind: 'extra', extra })}
              onEditReward={(reward) => setEditor({ kind: 'reward', reward })}
              onLock={async () => {
                await api.lock();
                setUnlocked(false);
                setTab('today');
                say('Settings locked', 258);
              }}
            />
          )}
        </div>

        {!isSidebar && (
          <nav
            style={{
              flex: 'none',
              display: 'flex',
              justifyContent: 'center',
              gap: 10,
              padding: '10px 20px 18px',
            }}
          >
            {tabs.map((t) => (
              <NavButton
                key={t.id}
                {...t}
                active={tab === t.id}
                onClick={() => (t.id === 'settings' ? openSettings() : setTab(t.id))}
              />
            ))}
          </nav>
        )}
      </main>

      {idle && (
        <IdleFrame
          now={now}
          events={idleEvents.events}
          people={people}
        />
      )}

      {confetti && <Confetti hues={confetti} big />}
      {version.stale && !idle ? (
        <UpdateToast version={version.current} onReload={() => window.location.reload()} />
      ) : (
        <Toast toast={toast} />
      )}

      {pinPrompt && (
        <PinPad
          onUnlocked={() => {
            setUnlocked(true);
            setPinPrompt(false);
            setTab('settings');
          }}
          onCancel={() => setPinPrompt(false)}
        />
      )}

      {renderEditor()}
    </div>
  );

  function renderEditor() {
    if (!editor || !board) return null;
    const close = () => setEditor(null);

    /** Any parent-gated save can come back 401 if the session lapsed. */
    const guard = async (action: () => Promise<void>) => {
      try {
        await action();
      } catch (err) {
        if (err instanceof ApiError && err.needsPin) {
          setUnlocked(false);
          setPinPrompt(true);
          say('Settings locked — enter the PIN', 25);
          return;
        }
        say(err instanceof Error ? err.message : 'Something went wrong', 25);
      }
    };

    switch (editor.kind) {
      case 'person':
        return (
          <PersonEditor
            person={editor.person}
            night={night}
            onClose={close}
            onSave={(patch) =>
              void guard(async () => {
                if (editor.person) await api.updatePerson(editor.person.id, patch);
                else await api.createPerson(patch);
                await data.reloadPeople();
                say('Saved', 148);
                close();
              })
            }
            onDelete={
              editor.person
                ? () =>
                    void guard(async () => {
                      await api.deletePerson(editor.person!.id);
                      await data.reloadPeople();
                      await data.reloadBoard();
                      say('Removed', 25);
                      close();
                    })
                : undefined
            }
          />
        );

      case 'chore':
        return (
          <ChoreEditor
            chore={editor.chore}
            people={people}
            night={night}
            onClose={close}
            onSave={(patch) =>
              void guard(async () => {
                if (editor.chore) await api.updateChore(editor.chore.id, patch);
                else await api.createChore(patch);
                await data.reloadBoard();
                say('Saved', 148);
                close();
              })
            }
            onDelete={
              editor.chore
                ? () =>
                    void guard(async () => {
                      await api.deleteChore(editor.chore!.id);
                      await data.reloadBoard();
                      say('Deleted', 25);
                      close();
                    })
                : undefined
            }
          />
        );

      case 'extra':
        return (
          <ExtraEditor
            extra={editor.extra}
            onClose={close}
            onSave={(patch) =>
              void guard(async () => {
                if (editor.extra?.id) await api.updateExtra(editor.extra.id, patch);
                else await api.createExtra(patch);
                await data.reloadBoard();
                say('Saved', 148);
                close();
              })
            }
            onDelete={
              editor.extra?.id
                ? () =>
                    void guard(async () => {
                      await api.deleteExtra(editor.extra!.id!);
                      await data.reloadBoard();
                      say('Deleted', 25);
                      close();
                    })
                : undefined
            }
          />
        );

      case 'reward':
        return (
          <RewardEditor
            reward={editor.reward}
            onClose={close}
            onSave={(patch) =>
              void guard(async () => {
                if (editor.reward?.id) await api.updateReward(editor.reward.id, patch);
                else await api.createReward(patch);
                await data.reloadBoard();
                say('Saved', 148);
                close();
              })
            }
            onDelete={
              editor.reward?.id
                ? () =>
                    void guard(async () => {
                      await api.deleteReward(editor.reward!.id!);
                      await data.reloadBoard();
                      say('Deleted', 25);
                      close();
                    })
                : undefined
            }
          />
        );

      case 'event':
        return (
          <EventEditor
            event={editor.event}
            defaultDate={anchor}
            onClose={close}
            onSaved={() => setCalendarNonce((n) => n + 1)}
            say={say}
          />
        );

      case 'pickExtra':
        return (
          <ExtraPicker
            person={editor.person}
            extras={board.extras}
            night={night}
            onClose={close}
            onPick={(extra) =>
              void guard(async () => {
                await api.claim(extra.id, editor.person.id);
                await data.reloadBoard();
                say(`${extra.title} added to ${editor.person.name}'s board`, editor.person.hue);
                close();
              })
            }
          />
        );

      case 'catalog':
        return (
          <PrizeCatalog
            people={people}
            initialPersonId={editor.person.id}
            rewards={board.rewards}
            redemptions={board.redemptions}
            pointsFor={(id) => board.points.find((p) => p.personId === id)?.points ?? 0}
            night={night}
            onClose={close}
            onRedeem={(person, reward) =>
              void guard(async () => {
                await api.redeem(person.id, reward.id);
                await data.reloadBoard();
                say(`${person.name} redeemed ${reward.label}!`, person.hue);
                celebrate([person.hue, 305, 62]);
              })
            }
            onSetGoal={(person, reward) =>
              void guard(async () => {
                await api.updatePerson(person.id, { goalRewardId: reward.id });
                await data.reloadPeople();
                say(`${person.name} is saving for ${reward.label}`, person.hue);
              })
            }
          />
        );
    }
  }
}

function NavButton({
  label,
  icon,
  badge,
  active,
  rail,
  onClick,
}: {
  label: string;
  icon: IconName;
  badge: number;
  active: boolean;
  rail?: boolean;
  onClick: () => void;
}) {
  const base: React.CSSProperties = rail
    ? {
        position: 'relative',
        width: 88,
        height: 72,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        borderRadius: 22,
        background: active ? 'var(--chip)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink2)',
      }
    : {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '11px 19px',
        borderRadius: 999,
        border: active ? '1px solid transparent' : '1px solid var(--line)',
        background: active ? 'var(--ink)' : 'transparent',
        color: active ? 'var(--card)' : 'var(--ink2)',
      };

  return (
    <TapButton onClick={onClick} style={{ ...base, fontSize: 16.5, fontWeight: 800, transition: `all .3s ${EASE}` }}>
      <Icon name={icon} size={rail ? 24 : 20} />
      <span style={{ fontSize: rail ? 13 : 16.5, fontWeight: 800 }}>{label}</span>
      {badge > 0 && (
        <span
          style={
            rail
              ? {
                  position: 'absolute',
                  top: 7,
                  right: 11,
                  minWidth: 22,
                  padding: '2px 6px',
                  borderRadius: 999,
                  background: 'oklch(0.68 0.15 25)',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 800,
                  animation: `popIn .4s ${EASE} both`,
                }
              : {
                  minWidth: 23,
                  padding: '2px 7px',
                  borderRadius: 999,
                  background: active ? 'var(--card)' : 'oklch(0.68 0.15 25)',
                  color: active ? 'var(--ink)' : '#fff',
                  fontSize: 13,
                  fontWeight: 800,
                }
          }
        >
          {badge}
        </span>
      )}
    </TapButton>
  );
}

function Splash({ text, night, tone }: { text: string; night: boolean; tone?: 'error' }) {
  return (
    <div
      style={{
        ...rootVars(night),
        background: 'var(--bg)',
        color: tone === 'error' ? 'oklch(0.62 0.19 25)' : 'var(--ink2)',
        height: '100vh',
        display: 'grid',
        placeItems: 'center',
        fontSize: 20,
        fontWeight: 800,
        textAlign: 'center',
        padding: 32,
      }}
    >
      {text}
    </div>
  );
}

/**
 * The month a whole-week or whole-month view is sitting in, with the year
 * underneath. A week straddling two months names both — calling Aug 30–Sep 5
 * "August" would be a half-truth, and it is exactly the week you most need the
 * header to be honest about.
 */
function spanLabel(
  view: CalView,
  anchor: Date,
  weekStart: WeekStart,
): { title: string; sub: string } {
  if (view === 'month') {
    return {
      title: anchor.toLocaleDateString('en-US', { month: 'long' }),
      sub: String(anchor.getFullYear()),
    };
  }

  // `rangeFor` ends exclusive, so the last day on screen is the day before it.
  const [start, end] = rangeFor('week', anchor, weekStart);
  const last = new Date(end);
  last.setDate(last.getDate() - 1);

  if (start.getMonth() === last.getMonth() && start.getFullYear() === last.getFullYear()) {
    return {
      title: start.toLocaleDateString('en-US', { month: 'long' }),
      sub: String(start.getFullYear()),
    };
  }

  const short = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' });
  return {
    title: `${short(start)} – ${short(last)}`,
    sub:
      start.getFullYear() === last.getFullYear()
        ? String(start.getFullYear())
        : `${start.getFullYear()} – ${last.getFullYear()}`,
  };
}

function shift(anchor: Date, view: CalView, direction: number): Date {
  const d = new Date(anchor);
  if (view === 'day') d.setDate(d.getDate() + direction);
  else if (view === 'week') d.setDate(d.getDate() + 7 * direction);
  else d.setMonth(d.getMonth() + direction);
  return d;
}

/** Steps a `YYYY-MM-DD` by whole days, parsed as local midnight. */
function shiftDay(date: string, by: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + by);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today as `YYYY-MM-DD` in local time — never via toISOString, which is UTC. */
function localToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whether a board date is behind, level with, or ahead of today. */
function dayDirection(date: string): 'past' | 'today' | 'future' {
  const today = localToday();
  if (date < today) return 'past';
  if (date > today) return 'future';
  return 'today';
}
