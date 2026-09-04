import {
  type CalendarEvent,
  type Person,
  type Recurrence,
  type SubscribedCalendar,
  describeRecurrence,
  eventEnd,
  eventStart,
  everyDay,
  upsertWhoTag,
} from '@dashboard/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Field, GhostButton, Modal, PrimaryButton, fieldStyle } from './Modal';
import { PeoplePicker } from './pickers';
import { RecurrenceDialog } from './RepeatPicker';
import { Button, TapButton } from './ui';

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
  // The Who: tag Hearth reads people out of is not a note anyone wrote, so it
  // is stripped from what shows here — the picker above already says who.
  const [description, setDescription] = useState(visibleNotes(event?.description ?? null));
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
  const [recurrenceOpen, setRecurrenceOpen] = useState(false);
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
          // Only sent when it changed: every other save leaves the tag in the
          // description where it is rather than re-deciding who is going.
          ...(samePeople(personIds, event.personIds) ? {} : { personIds }),
          scope: pickedScope,
        });
      } else {
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
        {visibleNotes(readOnlyEvent.description) && (
          // Google returns this as authored, newlines and all, so it is rendered
          // as text rather than markup — an event body can contain anything.
          <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {visibleNotes(readOnlyEvent.description)}
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

  // The rule lives behind an async fetch (see the effect above), so the row
  // that opens it is always here from the first render — disabled and saying
  // so — rather than appearing only once the answer arrives.
  const loadingSeries = Boolean(event?.seriesId) && series === null;
  const lockedSeries = Boolean(series && !series.editable);
  const repeatsSummary = loadingSeries
    ? 'Loading…'
    : lockedSeries
      ? 'Set in Google — cannot be changed here'
      : repeats
        ? describeRecurrence(recurrence)
        : 'Does not repeat';

  // A dialog is stacked on top whenever either of these is open, so the main
  // form beneath suspends its own Escape/outside-click handling until it is
  // the topmost thing on screen again.
  const stacked = recurrenceOpen || confirming !== null;

  return (
    <>
      <Modal
        title={event ? 'Edit event' : 'New event'}
        onClose={onClose}
        active={!stacked}
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
        <Field label="What">
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={fieldStyle} autoFocus />
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

        <Field label="Repeats">
          <TapButton
            disabled={loadingSeries || lockedSeries}
            onClick={() => {
              // The rule counts from the event's own day, so opening the
              // dialog to turn it on seeds that day now, matching whatever
              // the Day field currently says rather than a stale default.
              if (!repeats) setRecurrence((r) => ({ ...r, startsOn: date }));
              setRecurrenceOpen(true);
            }}
            style={{
              ...fieldStyle,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              textAlign: 'left',
              opacity: loadingSeries || lockedSeries ? 0.6 : 1,
            }}
          >
            {repeatsSummary}
          </TapButton>
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

        <Field label="Where (optional)">
          <input value={location} onChange={(e) => setLocation(e.target.value)} style={fieldStyle} />
        </Field>

        {/*
          Who is going is text on the event itself now, not where it is
          written — a "Who:" line in its description, so it reads the same
          from Google.
        */}
        <Field
          label="Who is going"
          sub={
            personIds.length
              ? 'Written into the description, so it reads right from Google too'
              : 'Pick nobody and Hearth guesses from the calendar and title instead'
          }
        >
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

      {recurrenceOpen && (
        <RecurrenceDialog
          repeats={repeats}
          recurrence={recurrence}
          night={night}
          onCancel={() => setRecurrenceOpen(false)}
          onDone={(nextRepeats, nextRecurrence) => {
            setRepeats(nextRepeats);
            setRecurrence(nextRecurrence);
            setRecurrenceOpen(false);
          }}
        />
      )}

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
    </>
  );
}

/**
 * "This event, or all of them?" — the question Google and Apple both ask, in
 * the same words, because a repeating event is two things at once and only the
 * person tapping knows which one they mean — asked in its own dialog, on top
 * of the form, rather than as a box that appears inline within it.
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
    <Modal
      title={`${verb} which of these?`}
      onClose={onCancel}
      width={420}
      footer={<GhostButton onClick={onCancel}>Cancel</GhostButton>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Button size="lg" onClick={() => onPick('this')} style={{ width: '100%' }}>
          This event
        </Button>
        <Button size="lg" onClick={() => onPick('all')} style={{ width: '100%' }}>
          All events
        </Button>
      </div>
    </Modal>
  );
}

/** Order is not meaningful in a set of attendees, so it is not compared. */
function samePeople(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

/** A description with any Who: tag stripped out, for showing as a note. */
function visibleNotes(description: string | null): string {
  return upsertWhoTag(description, []) ?? '';
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
