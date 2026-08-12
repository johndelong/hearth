import { type CalendarEvent, type Person, type SubscribedCalendar, eventEnd, eventStart } from '@dashboard/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Field, GhostButton, Modal, PrimaryButton, fieldStyle } from './Modal';
import { PeoplePicker } from './pickers';

/** `YYYY-MM-DD` and `HH:MM` in local time, which is what date/time inputs want. */
const dateValue = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const timeValue = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function EventEditor({
  event,
  people,
  night,
  defaultDate,
  onClose,
  onSaved,
  say,
}: {
  event: CalendarEvent | null;
  people: Person[];
  night: boolean;
  defaultDate: Date;
  onClose: () => void;
  onSaved: () => void;
  say: (text: string, hue?: number) => void;
}) {
  const [calendars, setCalendars] = useState<SubscribedCalendar[]>([]);
  const start = event ? eventStart(event) : roundedNext(defaultDate);
  const end = event ? eventEnd(event) : new Date(start.getTime() + 60 * 60_000);

  const [calendarId, setCalendarId] = useState(event?.calendarId ?? '');
  const [title, setTitle] = useState(event?.title ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [personIds, setPersonIds] = useState<string[]>(event?.personIds ?? []);
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
      // All-day events go up as plain dates, the same shape they come back in;
      // a timed one becomes a real instant, offset and all.
      const startIso = allDay ? date : new Date(`${date}T${from}`).toISOString();
      const endIso = allDay ? nextDay(date) : new Date(`${date}T${to}`).toISOString();

      const body = {
        calendarId,
        title: title.trim(),
        start: startIso,
        end: endIso,
        allDay,
        location: location.trim() || null,
        description: description.trim() || null,
      };

      if (event) {
        await api.updateEvent(event.id, body);
        // Who is going is a Hearth fact, not a Google one, so it is its own
        // call. Skipped when untouched, so editing a title never rewrites tags.
        if (!samePeople(personIds, event.personIds)) await api.setEventPeople(event.id, personIds);
      } else {
        // A new event has no Hearth id to tag until it has been pulled back, so
        // the create carries its people and the server files them after the sync.
        await api.createEvent({ ...body, personIds });
      }

      say(event ? 'Event updated' : 'Event added', 148);
      onSaved();
      onClose();
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not save the event', 25);
    } finally {
      setSaving(false);
    }
  };

  /** The read-only branch can still say who is going; that much is ours. */
  const saveAttendees = async () => {
    if (!event) return;
    setSaving(true);
    try {
      await api.setEventPeople(event.id, personIds);
      say('Saved who is going', 148);
      onSaved();
      onClose();
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not save', 25);
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
        footer={
          <>
            <GhostButton onClick={onClose}>Close</GhostButton>
            <PrimaryButton
              onClick={() => void saveAttendees()}
              disabled={saving || samePeople(personIds, readOnlyEvent.personIds)}
            >
              {saving ? 'Saving…' : 'Save who is going'}
            </PrimaryButton>
          </>
        }
      >
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink2)' }}>
          {readOnlyEvent.allDay
            ? 'All day'
            : `${new Date(readOnlyEvent.start).toLocaleString()} – ${new Date(readOnlyEvent.end).toLocaleTimeString()}`}
          {readOnlyEvent.location ? ` · ${readOnlyEvent.location}` : ''}
        </div>
        {readOnlyEvent.description && (
          // Google returns this as authored, newlines and all, so it is rendered
          // as text rather than markup — an event body can contain anything.
          <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {readOnlyEvent.description}
          </div>
        )}

        <Field label="Who is going" sub="Tagged in Hearth — this does not change anything in Google">
          <PeoplePicker people={people} selected={personIds} night={night} onChange={setPersonIds} />
        </Field>
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

      <Field label="Who is going" sub="Leave empty to use whoever the calendar belongs to">
        <PeoplePicker people={people} selected={personIds} night={night} onChange={setPersonIds} />
      </Field>

      <Field label="Notes (optional)">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          style={{ ...fieldStyle, minHeight: 92, padding: '14px 18px', resize: 'vertical', lineHeight: 1.45 }}
        />
      </Field>
    </Modal>
  );
}

/** Order is not meaningful in a set of attendees, so it is not compared. */
function samePeople(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
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
