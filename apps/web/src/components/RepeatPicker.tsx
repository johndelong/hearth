import {
  DAY_INITIALS,
  DAY_SHORT,
  type Recurrence,
  describeRecurrence,
  fromYmd,
  monthlyOptions,
} from '@dashboard/shared';
import { useState } from 'react';
import { Field, fieldStyle, labelStyle } from './Modal';
import { Button, Switch, TapButton } from './ui';
import { col, deep, soft } from '../theme';

/**
 * The repeat controls, shaped like the "Custom recurrence" dialog in Google
 * Calendar and Outlook — because that is the one recurrence UI every parent has
 * already used, and a chore board is no place to invent a second vocabulary.
 *
 * Closed, it is just the seven day buttons: the answer to "which days?" that
 * covers almost every chore. Opening `Repeat every` reveals the interval, and
 * choosing Months swaps the day buttons for the same either/or Google offers —
 * "on day 15" or "on the third Monday" — both read off the start date.
 *
 * Being early is deliberately not expressed here. That is a property of one
 * tick, not of the schedule, and it lives on the board instead.
 */
export function RepeatPicker({
  value,
  onChange,
  night,
}: {
  value: Recurrence;
  onChange: (next: Recurrence) => void;
  night: boolean;
}) {
  // Whether the interval controls are showing. Kept separately from the rule
  // because "every 1 week" is the same rule whether or not they are open.
  const [open, setOpen] = useState(value.freq === 'monthly' || value.interval > 1);
  const monthly = value.freq === 'monthly';
  const options = monthlyOptions(value.startsOn);

  const toggleDay = (day: number) => {
    const has = value.byDay.includes(day);
    // Never let the last day come off — a chore due on no day at all would
    // vanish from every board with no way to find it but this modal.
    if (has && value.byDay.length === 1) return;
    onChange({
      ...value,
      byDay: has ? value.byDay.filter((d) => d !== day) : [...value.byDay, day].sort((a, b) => a - b),
    });
  };

  const setInterval = (next: number) => onChange({ ...value, interval: Math.min(52, Math.max(1, next)) });

  const setFreq = (freq: Recurrence['freq']) => {
    if (freq === value.freq) return;
    if (freq === 'weekly') {
      onChange({ ...value, freq, byMonthDay: null, bySetPos: null });
      return;
    }
    // Monthly defaults to the day-of-month reading, the way Google's dropdown
    // opens on "Monthly on day N".
    onChange({ ...value, freq, byMonthDay: fromYmd(value.startsOn).getDate(), bySetPos: null });
  };

  const setStartsOn = (startsOn: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) return;
    const next = { ...value, startsOn };
    // Both monthly readings are derived from the start date, so moving it has
    // to move them too or the rule would quietly describe a different day.
    if (monthly) {
      const moved = monthlyOptions(startsOn);
      if (value.byMonthDay !== null) next.byMonthDay = fromYmd(startsOn).getDate();
      else {
        next.bySetPos = moved.pos;
        next.byDay = [fromYmd(startsOn).getDay()];
      }
    }
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {!monthly && (
        <Field label="Repeats on" sub="Tap the days this chore lands on">
          <div style={{ display: 'flex', gap: 7 }}>
            {DAY_INITIALS.map((initial, day) => {
              const on = value.byDay.includes(day);
              return (
                <TapButton
                  key={day}
                  onClick={() => toggleDay(day)}
                  title={DAY_SHORT[day]}
                  style={{
                    flex: '1 1 0',
                    minWidth: 0,
                    height: 54,
                    borderRadius: 999,
                    fontSize: 17,
                    fontWeight: 800,
                    border: `2px solid ${on ? col(148, night) : 'var(--line)'}`,
                    background: on ? soft(148, night) : 'transparent',
                    color: on ? deep(148, night) : 'var(--ink2)',
                  }}
                >
                  {initial}
                </TapButton>
              );
            })}
          </div>
        </Field>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          minHeight: 40,
        }}
      >
        <div>
          <div style={{ ...labelStyle, marginBottom: 2 }}>Repeat every</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink2)', opacity: 0.85 }}>
            {describeRecurrence(value)}
          </div>
        </div>
        <Switch
          on={open}
          night={night}
          label="Repeat every"
          onChange={(next) => {
            setOpen(next);
            // Closing has to put the rule back to plain weekly, or an invisible
            // "every 3 months" would keep running behind a switch that is off.
            if (!next) onChange({ ...value, freq: 'weekly', interval: 1, byMonthDay: null, bySetPos: null });
          }}
        />
      </div>

      {open && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            padding: 14,
            borderRadius: 18,
            border: '1px solid var(--line)',
            background: 'var(--chip)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Stepper value={value.interval} onChange={setInterval} />
            <div style={{ display: 'flex', gap: 8, flex: '1 1 180px' }}>
              {(['weekly', 'monthly'] as const).map((f) => (
                <Button
                  key={f}
                  size="lg"
                  selected={value.freq === f}
                  onClick={() => setFreq(f)}
                  style={{ flex: 1, fontSize: 16 }}
                >
                  {f === 'weekly' ? (value.interval === 1 ? 'Week' : 'Weeks') : value.interval === 1 ? 'Month' : 'Months'}
                </Button>
              ))}
            </div>
          </div>

          {monthly && (
            <Field label="Which day">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  size="lg"
                  selected={value.byMonthDay !== null}
                  onClick={() =>
                    onChange({ ...value, byMonthDay: fromYmd(value.startsOn).getDate(), bySetPos: null })
                  }
                  style={{ flex: '1 1 150px', fontSize: 16 }}
                >
                  {options.byMonthDay}
                </Button>
                <Button
                  size="lg"
                  selected={value.bySetPos !== null}
                  onClick={() =>
                    onChange({
                      ...value,
                      byMonthDay: null,
                      bySetPos: options.pos,
                      byDay: [fromYmd(value.startsOn).getDay()],
                    })
                  }
                  style={{ flex: '1 1 150px', fontSize: 16 }}
                >
                  {options.bySetPos}
                </Button>
              </div>
            </Field>
          )}

          <Field label="Starts" sub="The first day it appears, and the week the count starts from">
            <input
              type="date"
              value={value.startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
              style={fieldStyle}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

/** Minus/number/plus, sized for a thumb on a wall tablet rather than a mouse. */
function Stepper({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const step = (delta: number) => onChange(value + delta);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <StepButton label="−" onClick={() => step(-1)} disabled={value <= 1} />
      <div
        aria-live="polite"
        style={{
          minWidth: 52,
          textAlign: 'center',
          fontSize: 20,
          fontWeight: 800,
          color: 'var(--ink)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      <StepButton label="+" onClick={() => step(1)} disabled={value >= 52} />
    </div>
  );
}

function StepButton({
  label,
  onClick,
  disabled,
}: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <TapButton
      onClick={onClick}
      disabled={disabled}
      title={label === '+' ? 'More' : 'Fewer'}
      style={{
        width: 52,
        height: 52,
        borderRadius: 999,
        border: '1px solid var(--line)',
        background: 'var(--card)',
        color: 'var(--ink)',
        fontSize: 24,
        fontWeight: 800,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      {label}
    </TapButton>
  );
}
