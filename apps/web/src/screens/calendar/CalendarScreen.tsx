import type { CalendarEvent, Person, Settings } from '@dashboard/shared';
import { useMemo, useState } from 'react';
import { EASE } from '../../theme';
import { DayView } from './DayView';
import { MonthView } from './MonthView';
import { WeekView } from './WeekView';
import { type CalView, useEvents } from './useEvents';
import { useSyncHealth } from './useSyncHealth';

export interface CalendarScreenProps {
  view: CalView;
  anchor: Date;
  now: Date;
  people: Person[];
  settings: Settings;
  night: boolean;
  onEditEvent: (event: CalendarEvent) => void;
  /** Tapping a day in week or month drops into that day. */
  onOpenDay: (day: Date) => void;
}

export function CalendarScreen({
  view,
  anchor,
  now,
  people,
  settings,
  night,
  onEditEvent,
  onOpenDay,
}: CalendarScreenProps) {
  const { events, loading, error } = useEvents(view, anchor, settings.weekStart);
  const syncWarning = useSyncHealth();
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  if (!loading && !hasLoadedOnce) setHasLoadedOnce(true);

  const byPerson = useMemo(() => {
    const map = new Map<string, Person>();
    for (const p of people) map.set(p.id, p);
    return map;
  }, [people]);

  if (error) {
    return <Notice text={error} tone="error" />;
  }

  // Only the very first load gets a placeholder; later refreshes swap silently
  // so the wall panel never flashes on a poll.
  if (loading && !hasLoadedOnce) {
    return <Notice text="Loading the calendar…" />;
  }

  const shared = { events, byPerson, night, settings, now, onEditEvent };

  return (
    <div
      style={{
        height: '100%',
        animation: `fadeIn .3s ${EASE} both`,
        display: 'grid',
        // The banner takes only the height it needs; the calendar keeps the rest,
        // so showing it never resizes the grid underneath.
        gridTemplateRows: syncWarning ? 'auto minmax(0, 1fr)' : 'minmax(0, 1fr)',
      }}
    >
      {syncWarning && <SyncWarning text={syncWarning} />}
      <div style={{ minHeight: 0 }}>
        {view === 'day' && <DayView {...shared} day={anchor} />}
        {view === 'week' && <WeekView {...shared} anchor={anchor} onOpenDay={onOpenDay} />}
        {view === 'month' && <MonthView {...shared} anchor={anchor} onOpenDay={onOpenDay} />}
      </div>
    </div>
  );
}

/**
 * A stale calendar is worth saying out loud, but not worth shouting: the panel
 * is furniture, and its events are still the best answer available. Amber rather
 * than red, and it never replaces the calendar the way an error does.
 */
function SyncWarning({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: '0 0 10px',
        padding: '9px 14px',
        borderRadius: 12,
        background: 'oklch(0.72 0.15 75 / 0.14)',
        color: 'oklch(0.66 0.15 75)',
        fontSize: 15,
        fontWeight: 700,
      }}
    >
      <span aria-hidden="true">⚠</span>
      {text}
    </div>
  );
}

export function Notice({ text, tone }: { text: string; tone?: 'error' }) {
  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        height: '100%',
        color: tone === 'error' ? 'oklch(0.62 0.19 25)' : 'var(--ink2)',
        fontSize: 18,
        fontWeight: 700,
        textAlign: 'center',
        padding: 32,
      }}
    >
      {text}
    </div>
  );
}
