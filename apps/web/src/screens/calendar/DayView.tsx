import type { CalendarEvent, Person, Settings } from '@dashboard/shared';
import { useEffect, useRef } from 'react';
import { Avatar, TapButton } from '../../components/ui';
import { CARD, EASE, col, deep, soft } from '../../theme';
import { dayHourRange, eventsOn, fmtTime, sameDay } from './useEvents';

interface Props {
  day: Date;
  now: Date;
  events: CalendarEvent[];
  byPerson: Map<string, Person>;
  night: boolean;
  settings: Settings;
  onEditEvent: (event: CalendarEvent) => void;
}

const FALLBACK: Person = {
  id: 'family',
  name: 'Family',
  hue: -1,
  role: 'shared',
  bday: null,
  byear: null,
  onChores: false,
  onCal: true,
  goalRewardId: null,
  avatarUrl: null,
  sortOrder: 99,
};

export function DayView({ day, now, events, byPerson, night, settings, onEditEvent }: Props) {
  const hours = dayHourRange(settings.dayHours);
  const dayEvents = eventsOn(events, day);
  const allDay = dayEvents.filter((e) => e.allDay);
  const timed = dayEvents.filter((e) => !e.allDay);
  const isToday = sameDay(day, now);
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

  const person = (e: CalendarEvent): Person => (e.personId ? byPerson.get(e.personId) ?? FALLBACK : FALLBACK);

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

      <div
        ref={scroller}
        style={{ ...cardBox, flex: 1, overflowY: 'auto', padding: '10px 20px 28px' }}
      >
        {hours.map((h, hi) => {
          const rowEvents = timed.filter((e) => new Date(e.start).getHours() === h);
          const isNow = isToday && now.getHours() === h;
          return (
            <div
              key={h}
              data-now={isNow ? 'true' : undefined}
              style={{
                position: 'relative',
                display: 'flex',
                gap: 18,
                alignItems: 'flex-start',
                minHeight: 78,
                padding: '12px 0',
                borderTop: hi === 0 ? 'none' : '1px solid var(--line)',
              }}
            >
              <div
                style={{
                  flex: 'none',
                  width: 74,
                  paddingTop: 2,
                  fontSize: 14.5,
                  fontWeight: 800,
                  color: isNow ? col(25, night) : 'var(--ink2)',
                }}
              >
                {(h % 12 || 12) + (h < 12 ? ' AM' : ' PM')}
              </div>

              <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 10, minWidth: 0 }}>
                {rowEvents.map((e, ei) => {
                  const p = person(e);
                  return (
                    <TapButton
                      key={e.id}
                      onClick={() => !e.synthetic && onEditEvent(e)}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        flex: '1 1 208px',
                        maxWidth: 330,
                        minWidth: 0,
                        padding: '10px 13px',
                        borderRadius: 14,
                        borderLeft: `3px solid ${col(p.hue, night)}`,
                        background: soft(p.hue, night),
                        color: deep(p.hue, night),
                        textAlign: 'left',
                        animation: `riseIn .45s ${EASE} ${hi * 18 + ei * 30}ms both`,
                      }}
                    >
                      <Avatar name={p.name} hue={p.hue} night={night} size={27} avatarUrl={p.avatarUrl} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800, opacity: 0.75 }}>
                          {fmtTime(new Date(e.start))}
                        </span>
                        <span style={{ display: 'block', fontSize: 16.5, fontWeight: 800 }}>{e.title}</span>
                        {e.location && (
                          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, opacity: 0.7 }}>
                            {e.location}
                          </span>
                        )}
                      </span>
                    </TapButton>
                  );
                })}
              </div>

              {isNow && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: `${Math.round((now.getMinutes() / 60) * 100)}%`,
                    height: 2,
                    borderRadius: 2,
                    background: 'oklch(0.66 0.17 25)',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          );
        })}

        {timed.length === 0 && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink2)', fontWeight: 700 }}>
            Nothing scheduled. Enjoy the quiet.
          </div>
        )}
      </div>
    </div>
  );
}

const cardBox = {
  background: 'var(--card)',
  borderRadius: 26,
  boxShadow: '0 1px 2px rgba(20,24,40,.05),0 16px 34px -22px rgba(20,24,40,.26)',
} as const;

export { CARD };
