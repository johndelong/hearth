import type { CalendarEvent, Person, Settings } from '@dashboard/shared';
import { TapButton } from '../../components/ui';
import { EASE, col, deep, soft } from '../../theme';
import { eventsOn, rangeFor, sameDay } from './useEvents';

interface Props {
  anchor: Date;
  now: Date;
  events: CalendarEvent[];
  byPerson: Map<string, Person>;
  night: boolean;
  settings: Settings;
  onEditEvent: (event: CalendarEvent) => void;
}

const MAX_CHIPS = 3;

export function MonthView({ anchor, now, events, byPerson, night, settings, onEditEvent }: Props) {
  const [gridStart] = rangeFor('month', anchor, settings.weekStart);
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const dow = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  });

  // Legend doubles as a color key for the family.
  const legend = [...byPerson.values()].filter((p) => p.onCal && p.role !== 'shared');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 10, flex: 'none' }}>
        {dow.map((d) => (
          <div
            key={d}
            style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink2)', letterSpacing: 0.5, paddingLeft: 4 }}
          >
            {d.toUpperCase()}
          </div>
        ))}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0,1fr))',
          gridAutoRows: '1fr',
          gap: 10,
        }}
      >
        {days.map((day, i) => {
          const inMonth = day.getMonth() === anchor.getMonth();
          const today = sameDay(day, now);
          const dayEvents = eventsOn(events, day);
          const chips = dayEvents.slice(0, MAX_CHIPS);
          const overflow = dayEvents.length - chips.length;

          return (
            <div
              key={day.toISOString()}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                minHeight: 0,
                padding: '10px 10px 8px',
                borderRadius: 18,
                background: 'var(--card)',
                opacity: inMonth ? 1 : 0.45,
                outline: today ? '2px solid var(--ink)' : 'none',
                boxShadow: '0 1px 2px rgba(20,24,40,.05),0 12px 26px -20px rgba(20,24,40,.26)',
                animation: `riseIn .4s ${EASE} ${Math.min(i * 8, 260)}ms both`,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  fontFamily: 'Outfit',
                  fontSize: 17,
                  fontWeight: 600,
                  color: today ? 'var(--ink)' : 'var(--ink2)',
                }}
              >
                {day.getDate()}
              </div>

              {chips.map((e) => {
                const hue = e.personId ? byPerson.get(e.personId)?.hue ?? -1 : -1;
                return (
                  <TapButton
                    key={e.id}
                    onClick={() => !e.synthetic && onEditEvent(e)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '3px 8px',
                      borderRadius: 8,
                      background: soft(hue, night),
                      color: deep(hue, night),
                      fontSize: 12.5,
                      fontWeight: 800,
                      textAlign: 'left',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {e.title}
                  </TapButton>
                );
              })}

              {overflow > 0 && (
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink2)', paddingLeft: 4 }}>
                  +{overflow} more
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', flex: 'none', paddingTop: 2 }}>
        {legend.map((p) => (
          <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800, color: 'var(--ink2)' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: col(p.hue, night) }} />
            {p.name}
          </span>
        ))}
      </div>
    </div>
  );
}
