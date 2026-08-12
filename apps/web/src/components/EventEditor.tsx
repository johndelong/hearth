import {
  type CalendarEvent,
  type Person,
  type Recurrence,
  type SubscribedCalendar,
  describeRecurrence,
  eventEnd,
  eventStart,
  everyDay,
} from '@dashboard/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Field, GhostButton, Modal, PrimaryButton, fieldStyle } from './Modal';
import { PeoplePicker } from './pickers';
import { RepeatPicker } from './RepeatPicker';
import { Button } from './ui';

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
  const [repeats, setRepeats] = useState(false);
  const [recurrence, setRecurrence] = useState<Recurrence>(() => everyDay(dateValue(start)));
  /**
   * The series behind this occurrence: null while it is being read, and
   * `editable: false` when Google's rule is one the picker cannot represent.
   */
  const [series, setSeries] = useState<{ recurrence: Recurrence | null; editable: boolean } | null>(
    event?.seriesId ? null : { recurrence: null, editable: true },
  );
  /** Which of a repeating event the pending action means. */
  const [scope, setScope] = useState<'this' | 'all'>('this');
  const [confirming, setConfirming] = useState<'save' | 'delete' | null>(null);
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [date, setDate] = useState(dateValue(start));
  const [from, setFrom] = useState(timeValue(start));
  const [to, setTo] = useState(timeValue(end));
  const [saving, setSaving] = useState(false);

  // The rule lives on the master Google keeps behind the expansion, so it is
  // only knowable by asking. Until it lands, the repeat controls stay shut.
  useEffect(() => {
    if (!event?.seriesId) return;
    let live = true;
    void api
      .eventSeries(event.id)
      .then((data) => {
        if (!live) return;
        setSeries(data);
        if (data.recurrence) {
          setRecurrence(data.recurrence);
          setRepeats(true);
        }
      })
      .catch(() => live && setSeries({ recurrence: null, editable: false }));
    return () => {
      live = false;
    };
  }, [event?.id, event?.seriesId]);

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

  // Only somebody with a writable calendar can be given a copy, so only they
  // are offered — and the rest are named, rather than quietly left out.
  const owns = new Set(calendars.map((c) => c.personId).filter(Boolean));
  const canAttend = people.filter((p) => owns.has(p.id));
  const missing = people.filter((p) => !owns.has(p.id));

  const save = async (pickedScope: 'this' | 'all' = scope) => {
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
        // How it repeats is a property of the series, so it only ever travels
        // with an "all events" save. Sending it on one occurrence is refused by
        // the API rather than quietly reinterpreted.
        const repeatPatch =
          event.seriesId && pickedScope === 'all' && series?.editable
            ? { recurrence: repeats ? recurrence : null }
            : !event.seriesId && repeats
              ? // A one-off becoming a series counts from its own day, which the
                // Day field may have moved since the rule was switched on.
                { recurrence: { ...recurrence, startsOn: date } }
              : {};
        await api.updateEvent(event.id, {
          ...body,
          ...repeatPatch,
          // Only sent when it changed: every other save leaves the copies where
          // they are rather than re-deciding who is going.
          ...(samePeople(personIds, event.personIds) ? {} : { personIds }),
          scope: pickedScope,
        });
      } else {
        // A new event has no Hearth id to tag until it has been pulled back, so
        // the create carries its people and the server files them after the sync.
        await api.createEvent({
          ...body,
          personIds,
          ...(repeats ? { recurrence: { ...recurrence, startsOn: date } } : {}),
        });
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

  const remove = async (pickedScope: 'this' | 'all' = scope) => {
    if (!event) return;
    setSaving(true);
    try {
      await api.deleteEvent(event.id, pickedScope);
      say(pickedScope === 'all' ? 'Every one of them deleted' : 'Event deleted', 25);
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
        {readOnlyEvent.description && (
          // Google returns this as authored, newlines and all, so it is rendered
          // as text rather than markup — an event body can contain anything.
          <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {readOnlyEvent.description}
          </div>
        )}
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
          {event && (
            <GhostButton onClick={() => (event.seriesId ? setConfirming('delete') : void remove())} danger>
              Delete
            </GhostButton>
          )}
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            onClick={() => (event?.seriesId ? setConfirming('save') : void save())}
            disabled={!title.trim() || !calendarId || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </>
      }
    >
      {/*
        A repeating event has to say which of itself is meant. Asked once, at
        the moment of acting, rather than as a mode the whole form sits in —
        the answer is about this edit, not about the event.
      */}
      {confirming && (
        <ScopePrompt
          action={confirming}
          onCancel={() => setConfirming(null)}
          onPick={(picked) => {
            setScope(picked);
            setConfirming(null);
            // State set in the same tick is not readable by the handler, so the
            // choice is passed down rather than read back out.
            if (confirming === 'delete') void remove(picked);
            else void save(picked);
          }}
        />
      )}
      <Field label="What">
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={fieldStyle} autoFocus />
      </Field>

      {/* With people named, their calendars are the answer and this is noise. */}
      {personIds.length === 0 && (
        <Field label="Calendar">
          <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} style={fieldStyle}>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.summary}
              </option>
            ))}
          </select>
        </Field>
      )}

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

      {series && !series.editable && (
        <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--ink2)' }}>
          This repeats on a rule Hearth cannot show — change how it repeats in Google.
        </div>
      )}

      {(!event || !event.seriesId || series?.editable) && (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 17, fontWeight: 800 }}>
            <input
              type="checkbox"
              checked={repeats}
              onChange={(e) => {
                setRepeats(e.target.checked);
                // The rule counts from the event's own day, so a start that no
                // longer matches would silently shift which days it lands on.
                if (e.target.checked) setRecurrence((r) => ({ ...r, startsOn: date }));
              }}
              style={{ width: 22, height: 22 }}
            />
            Repeats
            {repeats && (
              <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink2)' }}>
                · {describeRecurrence(recurrence)}
              </span>
            )}
          </label>

          {repeats && (
            <RepeatPicker value={recurrence} onChange={setRecurrence} night={night} variant="event" />
          )}
        </>
      )}

      {/*
        Who is going is where the event is written: everyone named gets a real
        copy on their own calendar, so Google reads the way the panel does.
      */}
      <Field
        label="Who is going"
        sub={
          personIds.length
            ? 'It goes on their calendars, so it reads right in Google too'
            : 'Pick nobody and it goes on the calendar below'
        }
      >
        <PeoplePicker people={canAttend} selected={personIds} night={night} onChange={setPersonIds} />
        {missing.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 14.5, fontWeight: 600, color: 'var(--ink2)' }}>
            {missing.map((p) => p.name).join(' and ')}{' '}
            {missing.length === 1 ? 'has no calendar' : 'have no calendars'} yet — give{' '}
            {missing.length === 1 ? 'them one' : 'them one each'} in Settings › Calendar to add{' '}
            {missing.length === 1 ? 'them' : 'them'} here.
          </div>
        )}
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

/**
 * "This event, or all of them?" — the question Google and Apple both ask, in
 * the same words, because a repeating event is two things at once and only the
 * person tapping knows which one they mean.
 */
function ScopePrompt({
  action,
  onPick,
  onCancel,
}: {
  action: 'save' | 'delete';
  onPick: (scope: 'this' | 'all') => void;
  onCancel: () => void;
}) {
  const verb = action === 'delete' ? 'Delete' : 'Change';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 16,
        borderRadius: 18,
        border: '1px solid var(--line)',
        background: 'var(--chip)',
      }}
    >
      <div style={{ fontSize: 16.5, fontWeight: 800 }}>{verb} which of these?</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Button size="lg" onClick={() => onPick('this')} style={{ flex: '1 1 150px' }}>
          This event
        </Button>
        <Button size="lg" onClick={() => onPick('all')} style={{ flex: '1 1 150px' }}>
          All events
        </Button>
        <Button size="lg" onClick={onCancel} style={{ flex: '0 0 auto' }}>
          Cancel
        </Button>
      </div>
    </div>
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
