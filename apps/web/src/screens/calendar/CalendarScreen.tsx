import type { CalendarEvent, Person, Settings } from '@dashboard/shared';
import { useMemo, useState } from 'react';
import { EASE } from '../../theme';
import { DayView } from './DayView';
import { MonthView } from './MonthView';
import { WeekView } from './WeekView';
import { type CalView, useEvents } from './useEvents';

export interface CalendarScreenProps {
  view: CalView;
  anchor: Date;
  now: Date;
  people: Person[];
  settings: Settings;
  night: boolean;
  onEditEvent: (event: CalendarEvent) => void;
}

export function CalendarScreen({
  view,
  anchor,
  now,
  people,
  settings,
  night,
  onEditEvent,
}: CalendarScreenProps) {
  const { events, loading, error } = useEvents(view, anchor, settings.weekStart);
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
    <div style={{ height: '100%', animation: `fadeIn .3s ${EASE} both` }}>
      {view === 'day' && <DayView {...shared} day={anchor} />}
      {view === 'week' && <WeekView {...shared} anchor={anchor} />}
      {view === 'month' && <MonthView {...shared} anchor={anchor} />}
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
