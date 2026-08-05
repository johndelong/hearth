import type { CalendarEvent, SubscribedCalendar } from '@dashboard/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Field, GhostButton, Modal, PrimaryButton, fieldStyle } from './Modal';

/** `YYYY-MM-DD` and `HH:MM` in local time, which is what date/time inputs want. */
const dateValue = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const timeValue = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function EventEditor({
  event,
  defaultDate,
  onClose,
  onSaved,
  say,
}: {
  event: CalendarEvent | null;
  defaultDate: Date;
  onClose: () => void;
  onSaved: () => void;
  say: (text: string, hue?: number) => void;
}) {
  const [calendars, setCalendars] = useState<SubscribedCalendar[]>([]);
  const start = event ? new Date(event.start) : roundedNext(defaultDate);
  const end = event ? new Date(event.end) : new Date(start.getTime() + 60 * 60_000);

  const [calendarId, setCalendarId] = useState(event?.calendarId ?? '');
  const [title, setTitle] = useState(event?.title ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [date, setDate] = useState(dateValue(start));
  const [from, setFrom] = useState(timeValue(start));
  const [to, setTo] = useState(timeValue(end));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .calendars()
      .then((data) => {
        const writable = data.calendars.filter((c) => !c.readOnly && c.enabled);
        setCalendars(writable);
        setCalendarId((current) => current || writable[0]?.id || '');
      })
      .catch(() => undefined);
  }, []);

  // Narrowed so the read-only branch below can lean on `event` being present.
  const readOnlyEvent = event?.readOnly ? event : null;

  const save = async () => {
    setSaving(true);
    try {
      const startIso = allDay ? `${date}T00:00:00` : new Date(`${date}T${from}`).toISOString();
      const endIso = allDay
        ? `${nextDay(date)}T00:00:00`
        : new Date(`${date}T${to}`).toISOString();

      const body = {
        calendarId,
        title: title.trim(),
        start: startIso,
        end: endIso,
        allDay,
        location: location.trim() || null,
      };

      if (event) await api.updateEvent(event.id, body);
      else await api.createEvent(body);

      say(event ? 'Event updated' : 'Event added', 148);
      onSaved();
      onClose();
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not save the event', 25);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!event) return;
    setSaving(true);
    try {
      await api.deleteEvent(event.id);
      say('Event deleted', 25);
      onSaved();
      onClose();
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not delete the event', 25);
    } finally {
      setSaving(false);
    }
  };

  if (readOnlyEvent) {
    return (
      <Modal
        title={readOnlyEvent.title}
        sub="This event lives on a read-only calendar, so it can only be changed in Google."
        onClose={onClose}
        footer={<GhostButton onClick={onClose}>Close</GhostButton>}
      >
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink2)' }}>
          {readOnlyEvent.allDay
            ? 'All day'
            : `${new Date(readOnlyEvent.start).toLocaleString()} – ${new Date(readOnlyEvent.end).toLocaleTimeString()}`}
          {readOnlyEvent.location ? ` · ${readOnlyEvent.location}` : ''}
        </div>
      </Modal>
    );
  }

  if (calendars.length === 0 && !event) {
    return (
      <Modal
        title="No writable calendar"
        sub="Connect a Google account you own in Settings › Calendar before adding events."
        onClose={onClose}
        footer={<GhostButton onClick={onClose}>Close</GhostButton>}
      >
        <div style={{ color: 'var(--ink2)', fontWeight: 700 }}>
          Subscribed and shared calendars are read-only.
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={event ? 'Edit event' : 'New event'}
      onClose={onClose}
      footer={
        <>
          {event && <GhostButton onClick={() => void remove()} danger>Delete</GhostButton>}
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={() => void save()} disabled={!title.trim() || !calendarId || saving}>
            {saving ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </>
      }
    >
      <Field label="What">
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={fieldStyle} autoFocus />
      </Field>

      <Field label="Calendar">
        <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} style={fieldStyle}>
          {calendars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.summary}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Day">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={fieldStyle} />
      </Field>

      <label style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 17, fontWeight: 800 }}>
        <input
          type="checkbox"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
          style={{ width: 22, height: 22 }}
        />
        All day
      </label>

      {!allDay && (
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Field label="Starts">
              <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} style={fieldStyle} />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Ends">
              <input type="time" value={to} onChange={(e) => setTo(e.target.value)} style={fieldStyle} />
            </Field>
          </div>
        </div>
      )}

      <Field label="Where (optional)">
        <input value={location} onChange={(e) => setLocation(e.target.value)} style={fieldStyle} />
      </Field>
    </Modal>
  );
}

/** Next half hour, so a new event does not default to an awkward time. */
function roundedNext(from: Date): Date {
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() > 30 ? 60 : 30);
  return d;
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return dateValue(d);
}
