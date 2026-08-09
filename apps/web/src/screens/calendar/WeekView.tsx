import { type CalendarEvent, type Person, type Settings, eventStart } from '@dashboard/shared';
import { Card, TapButton } from '../../components/ui';
import { EASE, col, deep, soft } from '../../theme';
import { eventsOn, fmtTime, rangeFor, sameDay } from './useEvents';

interface Props {
  anchor: Date;
  now: Date;
  events: CalendarEvent[];
  byPerson: Map<string, Person>;
  night: boolean;
  settings: Settings;
  onEditEvent: (event: CalendarEvent) => void;
  onOpenDay: (day: Date) => void;
}

export function WeekView({
  anchor,
  now,
  events,
  byPerson,
  night,
  settings,
  onEditEvent,
  onOpenDay,
}: Props) {
  const [start] = rangeFor('week', anchor, settings.weekStart);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        gap: 12,
        height: '100%',
      }}
    >
      {days.map((day, di) => {
        const today = sameDay(day, now);
        const dayEvents = eventsOn(events, day);
        return (
          <Card
            key={day.toISOString()}
            delay={di * 40}
            onClick={() => onOpenDay(day)}
            style={{
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              borderRadius: 24,
              // Today lifts slightly further off the page.
              boxShadow: today
                ? '0 1px 2px rgba(20,24,40,.05),0 20px 40px -24px rgba(20,24,40,.4)'
                : undefined,
              outline: today ? '2px solid var(--ink)' : 'none',
            }}
          >
            <div style={{ padding: '16px 16px 10px', flex: 'none' }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ink2)', letterSpacing: 0.4 }}>
                {day.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}
              </div>
              <div style={{ fontFamily: 'Outfit', fontSize: 27, fontWeight: 600, lineHeight: 1.1 }}>
                {day.getDate()}
              </div>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
                padding: '0 12px 16px',
              }}
            >
              {dayEvents.map((e) => {
                const p = e.personId ? byPerson.get(e.personId) : undefined;
                const hue = p?.hue ?? -1;
                return (
                  <TapButton
                    key={e.id}
                    // A synthetic event has nothing to edit, so its tap is left
                    // to fall through to the card and open the day instead.
                    onClick={(click) => {
                      if (e.synthetic) return;
                      click.stopPropagation();
                      onEditEvent(e);
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '8px 11px',
                      borderRadius: 12,
                      borderLeft: `3px solid ${col(hue, night)}`,
                      background: soft(hue, night),
                      color: deep(hue, night),
                      textAlign: 'left',
                    }}
                  >
                    {!e.allDay && (
                      <span style={{ display: 'block', fontSize: 12, fontWeight: 800, opacity: 0.72 }}>
                        {fmtTime(eventStart(e))}
                      </span>
                    )}
                    <span style={{ display: 'block', fontSize: 14.5, fontWeight: 800, lineHeight: 1.25 }}>
                      {e.title}
                    </span>
                  </TapButton>
                );
              })}
              {dayEvents.length === 0 && (
                <div style={{ padding: '8px 2px', fontSize: 13.5, fontWeight: 700, color: 'var(--ink2)', opacity: 0.6 }}>
                  Open
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
