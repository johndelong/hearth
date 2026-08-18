import { type CalendarEvent, type Person, type Settings, eventEnd, eventStart } from '@dashboard/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { EASE, col } from '../theme';
import { eventPeople, fmtTime } from '../screens/calendar/useEvents';

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

function ImmichSlideshow({ settings }: { settings: Settings }) {
  const [photos, setPhotos] = useState<Array<{ id: string; url: string }>>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await api.immichPhotos();
        if (!cancelled) {
          // A new visit gets a different point in the album, without putting a
          // predictable first family photo on a wall visible from a doorway.
          const next = settings.photoOrder === 'shuffle' ? shuffle(result.photos) : result.photos;
          setPhotos(next);
          setIndex(settings.photoOrder === 'shuffle' && next.length ? Math.floor(Math.random() * next.length) : 0);
        }
      } catch {
        if (!cancelled) setPhotos([]);
      }
    };
    void load();
    const refresh = window.setInterval(() => void load(), 15 * 60_000);
    return () => { cancelled = true; window.clearInterval(refresh); };
  }, [settings.photoOrder]);

  useEffect(() => {
    if (photos.length < 2) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % photos.length), settings.photoDuration * 1_000);
    return () => window.clearInterval(timer);
  }, [photos.length, settings.photoDuration]);

  useEffect(() => {
    if (index < photos.length) return;
    setIndex(0);
  }, [index, photos.length]);

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const transition = reducedMotion && settings.photoTransition !== 'none' ? 'fade' : settings.photoTransition;
  const dim = { low: '.60', medium: '.76', high: '.88' }[settings.photoDim];
  if (!photos.length) return null;
  const previous = (index - 1 + photos.length) % photos.length;
  const next = (index + 1) % photos.length;
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, background: '#000' }}>
      {photos.filter((_photo, position) => position === previous || position === index || position === next).map((photo) => {
        const position = photos.indexOf(photo);
        return (
        <img
          key={photo.id}
          src={photo.url}
          alt=""
          onError={() => {
            setPhotos((current) => current.filter((candidate) => candidate.id !== photo.id));
          }}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            opacity: position === index ? 1 : 0,
            objectFit: settings.photoFit === 'fit' ? 'contain' : 'cover',
            transform: transition === 'slide' ? (position === index ? 'translateX(0)' : 'translateX(7%)') : transition === 'zoom' && position === index ? 'scale(1.04)' : 'scale(1)',
            transition: transition === 'none' ? 'none' : 'opacity 1.6s ease, transform 4s ease-out',
          }}
        />
        );
      })}
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, rgba(0,0,0,.14) 0%, rgba(0,0,0,${dim}) 90%)` }} />
    </div>
  );
}

/**
 * The frame owns the whole waking gesture, rather than letting the touch reach
 * the app underneath it.
 *
 * Waking on the press would tear the tap in half: the frame unmounts while the
 * finger is still down, so the browser sends the rest of the gesture —
 * pointerup, then click — to whatever button happened to be under that spot,
 * and the touch that woke the panel also ticked off a chore. So we wake on the
 * release, hold the frame up for the whole press, and eat the click the
 * gesture leaves behind.
 */
const swallow = (e: React.PointerEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

/**
 * preventDefault on the pointer events already suppresses the mouse events a
 * touch would synthesise, but a real mouse still gets its click through. The
 * timer matters as much as the listener: on touch no click ever arrives, and a
 * once-listener left armed would silently eat the user's next real tap.
 */
const eatNextClick = () => {
  const eat = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('click', eat, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 400);
};

/** Which calendar square a date falls on locally, as a sortable number. */
const dayKey = (d: Date): number => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();

/**
 * Chronological, but grouped by day so that a day's all-day events sit above
 * its timed ones — the same order the day view uses, and the reason a birthday
 * reads as belonging to the day rather than to a moment in it.
 *
 * Sorting on the raw strings cannot do this: an all-day event is a plain date
 * and a timed one is a UTC instant, so a 9pm tonight (stored as tomorrow's
 * date in UTC) sorted below tomorrow's all-day events.
 *
 * Anything already under way is pulled up to today, since a trip that started
 * on Tuesday is happening now and shouldn't sort above what's left of today.
 */
const byWhen =
  (now: Date) =>
  (a: CalendarEvent, b: CalendarEvent): number => {
    const today = dayKey(now);
    const dayOf = (e: CalendarEvent) => Math.max(today, dayKey(eventStart(e)));

    const byDay = dayOf(a) - dayOf(b);
    if (byDay !== 0) return byDay;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;

    const byStart = eventStart(a).getTime() - eventStart(b).getTime();
    if (byStart !== 0) return byStart;

    // Same start: longest first, which is the order the day view stacks them in.
    return eventEnd(b).getTime() - eventEnd(a).getTime();
  };

export function IdleFrame({
  now,
  events,
  people,
  settings,
  onWake,
}: {
  now: Date;
  events: CalendarEvent[];
  people: Person[];
  settings: Settings;
  onWake: () => void;
}) {
  // What is left of today, plus anything already under way. The events query is
  // a deliberately coarse prefilter that reaches into the neighbouring days, so
  // without the day bound tomorrow's 7pm could appear here showing only "7 PM"
  // — under an empty state that promises this is today.
  const upcoming = events
    .filter((e) => eventEnd(e) > now && dayKey(eventStart(e)) <= dayKey(now))
    .sort(byWhen(now))
    .slice(0, 4);

  const byPerson = new Map(people.map((p) => [p.id, p]));

  return (
    <div
      onPointerDown={swallow}
      onPointerMove={swallow}
      onPointerCancel={swallow}
      onPointerUp={(e) => {
        swallow(e);
        eatNextClick();
        onWake();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        // No scrolling or double-tap zoom to fight the tap for ownership.
        touchAction: 'none',
        background: '#000',
        color: FRAME_INK,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        padding: '62px 70px 56px',
        overflow: 'hidden',
        animation: `fadeIn .8s ${EASE} both`,
      }}
    >
      <ImmichSlideshow settings={settings} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 40 }}>
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
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
            const p = eventPeople(e, byPerson)[0];
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

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
