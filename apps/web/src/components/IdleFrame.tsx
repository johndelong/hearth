import { type CalendarEvent, type Person, eventEnd, eventStart } from '@dashboard/shared';
import { EASE, col } from '../theme';
import { fmtTime } from '../screens/calendar/useEvents';

/**
 * Frame mode: what the panel shows when nobody has touched it. Big clock, the
 * next few things happening, and nothing tappable — any touch wakes it.
 *
 * Always black, in both themes. On the OLED panels this runs on, black is
 * pixels that are switched off — so frame mode is the one screen that should
 * never honour the light theme. That also means it cannot use --ink and
 * --ink2, which follow the theme and would leave dark text on a dark screen.
 */

/** Deliberately below pure white: a wall panel at 2am is in someone's hallway. */
const FRAME_INK = '#e4e7ee';
const FRAME_INK2 = '#767c88';

export function IdleFrame({
  now,
  events,
  people,
}: {
  now: Date;
  events: CalendarEvent[];
  people: Person[];
}) {
  const upcoming = events
    .filter((e) => eventEnd(e) > now)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 4);

  const byPerson = new Map(people.map((p) => [p.id, p]));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: '#000',
        color: FRAME_INK,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        padding: '62px 70px 56px',
        animation: `fadeIn .8s ${EASE} both`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 40 }}>
        <div>
          <div
            style={{
              fontFamily: 'Outfit',
              fontSize: 'clamp(90px, 15vw, 190px)',
              fontWeight: 300,
              lineHeight: 0.92,
              letterSpacing: -4,
            }}
          >
            {now.getHours() % 12 || 12}
            <span style={{ animation: 'colonPulse 1s ease-in-out infinite' }}>:</span>
            {String(now.getMinutes()).padStart(2, '0')}
          </div>
          <div style={{ marginTop: 14, fontSize: 26, fontWeight: 700, color: FRAME_INK2 }}>
            {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 300, maxWidth: '45vw' }}>
          {upcoming.map((e) => {
            const p = e.personId ? byPerson.get(e.personId) : undefined;
            return (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span
                  style={{
                    flex: 'none',
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    // Always the night palette: the ground is always black here.
                    background: col(p?.hue ?? -1, true),
                  }}
                />
                <span style={{ flex: 1, minWidth: 0, fontSize: 21, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.title}
                </span>
                <span style={{ flex: 'none', fontSize: 19, fontWeight: 700, color: FRAME_INK2 }}>
                  {e.allDay ? 'All day' : fmtTime(eventStart(e))}
                </span>
              </div>
            );
          })}
          {upcoming.length === 0 && (
            <div style={{ fontSize: 21, fontWeight: 700, color: FRAME_INK2 }}>Nothing else today.</div>
          )}
        </div>
      </div>
    </div>
  );
}
