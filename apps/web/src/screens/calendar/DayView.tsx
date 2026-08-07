import { type CalendarEvent, type Person, type Settings, eventEnd, eventStart } from '@dashboard/shared';
import { useEffect, useRef } from 'react';
import { Avatar, Card, TapButton } from '../../components/ui';
import { EASE, col, deep, soft } from '../../theme';
import { dayHourRange, eventsOn, fmtRange, layoutDay, sameDay } from './useEvents';

/**
 * Height of one hour of the grid. Every block's height is derived from this, so
 * the rows must be exactly this tall — hence `boxSizing: border-box`, which keeps
 * the 1px rule inside the row instead of drifting the grid a pixel per hour.
 */
const HOUR_H = 84;

/** Width of the hour-label gutter: the 74px label plus the 18px row gap. */
const GUTTER = 92;

/**
 * How far a block reaches under the lane to its right. Overlapping events are
 * drawn overlapping, cascading to the right and stacking in start order, rather
 * than each shrinking into a tidy column — a 9am that runs all morning stays
 * legible behind the two things booked across it.
 */
const LANE_OVERLAP = 0.34;

/**
 * Blocks lay out inside a track this wide rather than the whole panel. A lone
 * event stretched across a wall-mounted display reads as a banner rather than
 * an appointment; capping it keeps a one-event morning looking like the same
 * kind of object as a busy one.
 */
const TRACK_MAX = 640;

interface Props {
  day: Date;
  now: Date;
  events: CalendarEvent[];
  byPerson: Map<string, Person>;
  night: boolean;
  settings: Settings;
  onEditEvent: (event: CalendarEvent) => void;
}

/**
 * Events on a calendar nobody owns. Only the colour and the label are ever
 * read, so this is deliberately not a Person — it isn't one, and pretending
 * otherwise is what put a "Family" placeholder in the household to begin with.
 */
type EventOwner = Pick<Person, 'name' | 'hue' | 'avatarUrl' | 'avatarKey'>;

const FALLBACK: EventOwner = { name: 'Household', hue: -1, avatarUrl: null, avatarKey: null };

export function DayView({ day, now, events, byPerson, night, settings, onEditEvent }: Props) {
  const hours = dayHourRange(settings.dayHours);
  const dayEvents = eventsOn(events, day);
  const allDay = dayEvents.filter((e) => e.allDay);
  const timed = dayEvents.filter((e) => !e.allDay);
  const boxes = layoutDay(timed, day, hours);
  const isToday = sameDay(day, now);
  const nowMin = (now.getHours() - (hours[0] ?? 0)) * 60 + now.getMinutes();
  const showNowLine = isToday && nowMin >= 0 && nowMin <= hours.length * 60;
  const scroller = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string>('');

  // Land on the current hour when today opens, but never fight a manual scroll.
  useEffect(() => {
    const key = day.toDateString();
    if (!isToday || scrolledFor.current === key || !scroller.current) return;
    const row = scroller.current.querySelector<HTMLElement>('[data-now="true"]');
    if (!row) return;
    scrolledFor.current = key;
    scroller.current.scrollTo({ top: Math.max(0, row.offsetTop - 120), behavior: 'smooth' });
  }, [isToday, day, timed.length]);

  const person = (e: CalendarEvent): EventOwner =>
    (e.personId ? byPerson.get(e.personId) : undefined) ?? FALLBACK;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {settings.showAllDay && allDay.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', flex: 'none' }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink2)', minWidth: 62 }}>All day</span>
          {allDay.map((e) => {
            const p = person(e);
            return (
              <TapButton
                key={e.id}
                onClick={() => !e.synthetic && onEditEvent(e)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '9px 15px',
                  borderRadius: 999,
                  background: soft(p.hue, night),
                  color: deep(p.hue, night),
                  fontSize: 15.5,
                  fontWeight: 800,
                }}
              >
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: col(p.hue, night) }} />
                {e.title}
              </TapButton>
            );
          })}
        </div>
      )}

      <Card ref={scroller} style={{ flex: 1, overflowY: 'auto' }} padding="10px 20px 28px">
        <div style={{ position: 'relative' }}>
          {hours.map((h, hi) => {
            const isNow = isToday && now.getHours() === h;
            return (
              <div
                key={h}
                data-now={isNow ? 'true' : undefined}
                style={{
                  boxSizing: 'border-box',
                  height: HOUR_H,
                  paddingTop: 6,
                  borderTop: hi === 0 ? 'none' : '1px solid var(--line)',
                }}
              >
                <div
                  style={{
                    width: 74,
                    fontSize: 14.5,
                    fontWeight: 800,
                    color: isNow ? col(25, night) : 'var(--ink2)',
                  }}
                >
                  {(h % 12 || 12) + (h < 12 ? ' AM' : ' PM')}
                </div>
              </div>
            );
          })}

          {/* Blocks float above the grid; the layer itself must not eat taps. */}
          <div style={{ position: 'absolute', inset: 0, left: GUTTER, pointerEvents: 'none' }}>
            <div style={{ position: 'relative', height: '100%', maxWidth: TRACK_MAX }}>
              {boxes.map((box, i) => {
                const e = box.event;
                const p = person(e);
                const height = ((box.endMin - box.startMin) / 60) * HOUR_H - 4;
                const lane = 100 / box.columns;
                const left = box.column * lane;
                // Reach under the neighbour, but never past the track's edge.
                const width = Math.min(lane * (1 + LANE_OVERLAP), 100 - left);
                // Below roughly two lines of type there is only room for one.
                const tight = height < 58;

                return (
                  <TapButton
                    key={e.id}
                    onClick={() => !e.synthetic && onEditEvent(e)}
                    style={{
                      position: 'absolute',
                      pointerEvents: 'auto',
                      top: (box.startMin / 60) * HOUR_H,
                      height,
                      left: `${left}%`,
                      width: `${width}%`,
                      // Later lanes sit on top, so the pile reads left to right.
                      zIndex: box.column + 1,
                      display: 'flex',
                      alignItems: tight ? 'center' : 'flex-start',
                      gap: 10,
                      overflow: 'hidden',
                      padding: tight ? '6px 12px' : '9px 13px',
                      borderRadius: 14,
                      borderLeft: `3px solid ${col(p.hue, night)}`,
                      background: soft(p.hue, night),
                      color: deep(p.hue, night),
                      // A ring in the card colour keeps overlapping blocks from
                      // bleeding into one another where they cross.
                      boxShadow: box.columns > 1 ? '0 0 0 2px var(--card)' : undefined,
                      textAlign: 'left',
                      animation: `riseIn .45s ${EASE} ${i * 26}ms both`,
                    }}
                  >
                    {!tight && (
                      <Avatar name={p.name} hue={p.hue} night={night} size={27} avatarUrl={p.avatarUrl} avatarKey={p.avatarKey} />
                    )}
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800, opacity: 0.75 }}>
                        {fmtRange(eventStart(e), eventEnd(e))}
                      </span>
                      <span style={{ display: 'block', fontSize: tight ? 14.5 : 16.5, fontWeight: 800 }}>
                        {e.title}
                      </span>
                      {e.location && height >= 84 && (
                        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, opacity: 0.7 }}>
                          {e.location}
                        </span>
                      )}
                    </span>
                  </TapButton>
                );
              })}
            </div>

            {showNowLine && (
              <div
                style={{
                  position: 'absolute',
                  left: -GUTTER,
                  right: 0,
                  top: (nowMin / 60) * HOUR_H,
                  height: 2,
                  borderRadius: 2,
                  background: 'oklch(0.66 0.17 25)',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        </div>

        {timed.length === 0 && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink2)', fontWeight: 700 }}>
            Nothing scheduled. Enjoy the quiet.
          </div>
        )}
      </Card>
    </div>
  );
}
