import { type CalendarEvent, type Settings, eventEnd, eventStart } from '@dashboard/shared';
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
    .filter((e) => eventStart(e) < end && eventEnd(e) > start)
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

/** "5 – 11 PM", dropping the first suffix when both ends share it. */
export function fmtRange(start: Date, end: Date): string {
  const a = fmtTime(start);
  const b = fmtTime(end);
  const sameHalf = start.getHours() < 12 === end.getHours() < 12;
  return `${sameHalf ? a.replace(/ [AP]M$/, '') : a} – ${b}`;
}

/**
 * A timed event placed on the day grid: when it starts and ends in minutes from
 * the top of the visible band, and which of `columns` side-by-side lanes it sits
 * in. Both spans are already clamped to the band, so a block that runs past
 * midnight stops at the edge rather than overflowing the grid.
 */
export interface DayBox {
  event: CalendarEvent;
  startMin: number;
  endMin: number;
  column: number;
  columns: number;
}

/**
 * Shortest block we will draw. A 15-minute event laid out honestly is a sliver
 * too thin to read or tap, so it borrows a little height from the slot below.
 */
const MIN_BLOCK_MINUTES = 30;

/**
 * Lay timed events out as spanning blocks, splitting overlapping ones into
 * columns the way a desktop calendar does.
 *
 * Events are grouped into clusters of transitively-overlapping blocks — A and C
 * share a cluster if B overlaps both, even when they never touch each other —
 * and every block in a cluster is divided into the same number of lanes so their
 * edges line up. Within a cluster each event takes the leftmost lane that has
 * gone free, so a long block holds lane 0 while short ones stack beside it.
 */
export function layoutDay(events: CalendarEvent[], day: Date, hours: number[]): DayBox[] {
  const firstHour = hours[0];
  const lastHour = hours[hours.length - 1];
  if (firstHour === undefined || lastHour === undefined) return [];

  const bandStart = new Date(day);
  bandStart.setHours(firstHour, 0, 0, 0);
  const bandEnd = new Date(day);
  bandEnd.setHours(lastHour + 1, 0, 0, 0);
  const bandMinutes = (bandEnd.getTime() - bandStart.getTime()) / 60_000;

  const minutesFrom = (d: Date) => (d.getTime() - bandStart.getTime()) / 60_000;

  const placed = events
    .map((event) => {
      const startMin = Math.max(0, minutesFrom(eventStart(event)));
      const trueEnd = Math.min(bandMinutes, minutesFrom(eventEnd(event)));
      // Pad short events here rather than at render time, so the padded extent
      // is what overlap is measured against and stacked blocks never collide.
      const endMin = Math.min(bandMinutes, Math.max(trueEnd, startMin + MIN_BLOCK_MINUTES));
      return { event, startMin, endMin };
    })
    .filter((b) => b.endMin > 0 && b.startMin < bandMinutes)
    // Longer blocks first among equal starts, so they claim the leftmost lane.
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const boxes: DayBox[] = [];
  let cluster: DayBox[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const box of cluster) box.columns = laneEnds.length;
    boxes.push(...cluster);
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  };

  for (const b of placed) {
    if (b.startMin >= clusterEnd) flush();

    let lane = laneEnds.findIndex((end) => end <= b.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(b.endMin);
    } else {
      laneEnds[lane] = b.endMin;
    }

    cluster.push({ ...b, column: lane, columns: 1 });
    clusterEnd = Math.max(clusterEnd, b.endMin);
  }
  flush();

  return boxes;
}
