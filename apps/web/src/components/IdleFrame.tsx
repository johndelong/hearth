import type { CalendarEvent, Person, Settings } from '@dashboard/shared';
import { EASE, col } from '../theme';
import { fmtTime } from '../screens/calendar/useEvents';

/**
 * Frame mode: what the panel shows when nobody has touched it. Big clock, the
 * next few things happening, and nothing tappable — any touch wakes it.
 */
export function IdleFrame({
  now,
  events,
  people,
  settings,
  night,
}: {
  now: Date;
  events: CalendarEvent[];
  people: Person[];
  settings: Settings;
  night: boolean;
}) {
  const upcoming = events
    .filter((e) => new Date(e.end) > now)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 4);

  const byPerson = new Map(people.map((p) => [p.id, p]));
  const hour = now.getHours();
  const greeting = hour < 11 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: 'var(--bg)',
        color: 'var(--ink)',
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
            <span style={{ opacity: 0.35 }}>:</span>
            {String(now.getMinutes()).padStart(2, '0')}
          </div>
          <div style={{ marginTop: 14, fontSize: 26, fontWeight: 700, color: 'var(--ink2)' }}>
            {settings.playful ? greeting : ''}
            {settings.playful ? ' · ' : ''}
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
                    background: col(p?.hue ?? -1, night),
                  }}
                />
                <span style={{ flex: 1, minWidth: 0, fontSize: 21, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.title}
                </span>
                <span style={{ flex: 'none', fontSize: 19, fontWeight: 700, color: 'var(--ink2)' }}>
                  {e.allDay ? 'All day' : fmtTime(new Date(e.start))}
                </span>
              </div>
            );
          })}
          {upcoming.length === 0 && (
            <div style={{ fontSize: 21, fontWeight: 700, color: 'var(--ink2)' }}>Nothing else today.</div>
          )}
        </div>
      </div>
    </div>
  );
}
