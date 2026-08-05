import type { CalendarEvent, Settings } from '@dashboard/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';

export type CalView = 'day' | 'week' | 'month';

/** Inclusive start / exclusive end of the range a view needs to render. */
export function rangeFor(view: CalView, anchor: Date, weekStart: Settings['weekStart']): [Date, Date] {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);

  if (view === 'day') {
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return [start, end];
  }

  const firstDow = weekStart === 'Monday' ? 1 : 0;

  if (view === 'week') {
    const diff = (start.getDay() - firstDow + 7) % 7;
    start.setDate(start.getDate() - diff);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return [start, end];
  }

  // Month view shows whole weeks, so it bleeds into the neighbouring months.
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const lead = (monthStart.getDay() - firstDow + 7) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - lead);
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridEnd.getDate() + 42);
  return [gridStart, gridEnd];
}

export function useEvents(view: CalView, anchor: Date, weekStart: Settings['weekStart']) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [from, to] = rangeFor(view, anchor, weekStart);
  const fromKey = from.toISOString();
  const toKey = to.toISOString();

  const load = useCallback(async () => {
    try {
      setEvents(await api.events(new Date(fromKey), new Date(toKey)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load events');
    } finally {
      setLoading(false);
    }
  }, [fromKey, toKey]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Google is polled server-side every 5 minutes; match that here.
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return { events, loading, error, reload: load, from: new Date(fromKey), to: new Date(toKey) };
}

export const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Events touching a given day, timed ones first and in start order. */
export function eventsOn(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return events
    .filter((e) => new Date(e.start) < end && new Date(e.end) > start)
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return a.start.localeCompare(b.start);
    });
}

/** The hour band a day view covers, from the Display setting. */
export function dayHourRange(setting: Settings['dayHours']): number[] {
  const [first, last] = setting === 'All 24' ? [0, 23] : setting === '7a – 9p' ? [7, 21] : [6, 22];
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export function fmtTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const hour = h % 12 || 12;
  const suffix = h < 12 ? 'AM' : 'PM';
  return m ? `${hour}:${String(m).padStart(2, '0')} ${suffix}` : `${hour} ${suffix}`;
}
