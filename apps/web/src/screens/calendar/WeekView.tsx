import { type CalendarEvent, type Person, type Settings, eventStart } from '@dashboard/shared';
import { Card, TapButton } from '../../components/ui';
import { useNarrow } from '../../state';
import { col, deep, soft } from '../../theme';
import { eventHue, eventsOn, fmtTime, rangeFor, sameDay } from './useEvents';

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

  const narrow = useNarrow();
  if (narrow) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {days.map((day, di) => {
          const today = sameDay(day, now);
          const dayEvents = eventsOn(events, day);
          return (
            <Card
              key={day.toISOString()}
              delay={Math.min(di * 30, 180)}
              style={{
                display: 'flex',
                gap: 14,
                padding: '14px 16px',
                // Today lifts slightly further off the page, same as the wide grid.
                boxShadow: today
                  ? '0 1px 2px rgba(20,24,40,.05),0 20px 40px -24px rgba(20,24,40,.4)'
                  : undefined,
                outline: today ? '2px solid var(--ink)' : 'none',
              }}
            >
              <TapButton
                onClick={() => onOpenDay(day)}
                style={{ flex: 'none', width: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingTop: 2 }}
              >
                <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink2)', letterSpacing: 0.4 }}>
                  {day.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}
                </span>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    fontFamily: 'var(--font-display)',
                    fontSize: 19,
                    fontWeight: 600,
                    background: today ? 'var(--ink)' : 'transparent',
                    color: today ? 'var(--card)' : 'var(--ink)',
                  }}
                >
                  {day.getDate()}
                </span>
              </TapButton>

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 2 }}>
                {dayEvents.map((e) => {
                  const hue = eventHue(e, byPerson);
                  return (
                    <TapButton
                      key={e.id}
                      onClick={() => !e.synthetic && onEditEvent(e)}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '9px 12px',
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
                      <span style={{ display: 'block', fontSize: 14.5, fontWeight: 800, lineHeight: 1.3, whiteSpace: 'normal' }}>
                        {e.title}
                      </span>
                    </TapButton>
                  );
                })}
                {dayEvents.length === 0 && (
                  <TapButton
                    onClick={() => onOpenDay(day)}
                    style={{ display: 'block', padding: '9px 2px', fontSize: 13.5, fontWeight: 700, color: 'var(--ink2)', opacity: 0.6, textAlign: 'left' }}
                  >
                    Open
                  </TapButton>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    );
  }

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
              // A grid item's default min-width is its content's min-content,
              // not the track's actual size — without this, a long single
              // word (e.g. "Gymnastics") held the column open past its own
              // track, spilling text into the next day rather than wrapping.
              minWidth: 0,
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
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 27, fontWeight: 600, lineHeight: 1.1 }}>
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
                const hue = eventHue(e, byPerson);
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
                      minWidth: 0,
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
                    {/*
                      A column this narrow can't reliably fit a whole word —
                      "Volleyball" or "Gymnastics" alone can be wider than the
                      day track, so wrapping still overflowed it. One line
                      with an ellipsis (the same tradeoff macOS Calendar makes
                      here) reads better than a clipped mid-word wrap.
                    */}
                    <span
                      style={{
                        display: 'block',
                        minWidth: 0,
                        fontSize: 14.5,
                        fontWeight: 800,
                        lineHeight: 1.25,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
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
