import {
  type Chore,
  type GoogleAccount,
  type Person,
  type PointEvent,
  type Settings,
  type SubscribedCalendar,
  describeRecurrence,
} from '@dashboard/shared';
import { useCallback, useEffect, useState } from 'react';
import { type Board, type PointLedger, type VersionInfo, api } from '../../api';
import { displayVersion } from '../../components/UpdateNotice';
import { Field, GhostButton, Modal, PrimaryButton, fieldStyle } from '../../components/Modal';
import { Avatar, Button, Icon, Switch, TapButton } from '../../components/ui';
import { EASE, type IconName, col, deep, soft } from '../../theme';
import { ChipRow, ItemRow, Panel, ToggleRow, rowStyle } from './controls';

export type SettingsSection = 'family' | 'calendar' | 'chores' | 'points' | 'display' | 'security';

const SECTIONS: Array<{ id: SettingsSection; label: string; sub: string; icon: IconName }> = [
  { id: 'family', label: 'Family', sub: 'Everyone in the house', icon: 'star' },
  { id: 'calendar', label: 'Calendar', sub: 'Google accounts and subscriptions', icon: 'calendar' },
  { id: 'chores', label: 'Chores', sub: 'Boards, streaks, and the chore list', icon: 'check' },
  { id: 'points', label: 'Points', sub: 'Earning, spending, and history', icon: 'gift' },
  { id: 'display', label: 'Display', sub: 'Theme, frame mode, copy', icon: 'bulb' },
  { id: 'security', label: 'Parent PIN', sub: 'Who can change these settings', icon: 'lock' },
];

interface Props {
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  people: Person[];
  settings: Settings;
  board: Board;
  night: boolean;
  say: (text: string, hue?: number) => void;
  onSettingsChange: (settings: Settings) => void;
  onPeopleChange: () => Promise<void>;
  onBoardChange: () => Promise<void>;
  onEditPerson: (person: Person | null) => void;
  onEditChore: (chore: Chore | null) => void;
  onEditExtra: (extra: { id?: string; title: string; points: number } | null) => void;
  onEditReward: (reward: { id?: string; label: string; cost: number } | null) => void;
  onLock: () => void;
}

export function SettingsScreen(props: Props) {
  const { section, onSection, night } = props;

  return (
    <div className="settings-layout" style={{ display: 'flex', gap: 20, height: '100%', minHeight: 0 }}>
      <nav
        className="settings-nav"
        style={{
          flex: 'none',
          width: 268,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          overflowY: 'auto',
        }}
      >
        {SECTIONS.map((s) => {
          const on = s.id === section;
          return (
            <TapButton
              key={s.id}
              onClick={() => onSection(s.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 15,
                width: '100%',
                minHeight: 82,
                padding: '16px 18px',
                borderRadius: 22,
                textAlign: 'left',
                background: on ? 'var(--card)' : 'transparent',
                color: on ? 'var(--ink)' : 'var(--ink2)',
                boxShadow: on ? '0 1px 2px rgba(20,24,40,.05),0 14px 28px -20px rgba(20,24,40,.3)' : 'none',
              }}
            >
              <span
                style={{
                  flex: 'none',
                  width: 46,
                  height: 46,
                  borderRadius: 16,
                  display: 'grid',
                  placeItems: 'center',
                  background: on ? soft(258, night) : 'var(--chip)',
                  color: on ? deep(258, night) : 'var(--ink2)',
                }}
              >
                <Icon name={s.icon} size={22} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 17.5, fontWeight: 800 }}>{s.label}</span>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600, opacity: 0.8 }}>{s.sub}</span>
              </span>
            </TapButton>
          );
        })}
      </nav>

      <div
        className="settings-content"
        style={{
          flex: 1,
          minWidth: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          paddingBottom: 8,
        }}
      >
        {section === 'family' && <FamilySection {...props} />}
        {section === 'calendar' && <CalendarSection {...props} />}
        {section === 'chores' && <ChoresSection {...props} />}
        {section === 'points' && <PointsSection {...props} />}
        {section === 'display' && <DisplaySection {...props} />}
        {section === 'security' && <SecuritySection {...props} />}
      </div>
    </div>
  );
}

// ---------- family ----------

function FamilySection({ people, night, onEditPerson }: Props) {
  const roleLabel: Record<Person['role'], string> = {
    kid: 'Kid',
    parent: 'Parent',
  };

  return (
    <Panel
      title="Family members"
      sub="Tap anyone to edit their name, photo, color, and birthday"
      addLabel="+ Add someone"
      onAdd={() => onEditPerson(null)}
    >
      {people.map((p) => (
        <ItemRow
          key={p.id}
          label={p.name}
          sub={[roleLabel[p.role], p.bday ? bdayLabel(p.bday) : null].filter(Boolean).join(' · ')}
          leading={<Avatar name={p.name} hue={p.hue} night={night} size={46} avatarUrl={p.avatarUrl} avatarKey={p.avatarKey} ring />}
          onClick={() => onEditPerson(p)}
        />
      ))}
    </Panel>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function bdayLabel(bday: string): string {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(bday);
  if (!m) return '';
  return `${MONTHS[Number(m[1]) - 1] ?? ''} ${m[2]}`;
}

// ---------- calendar ----------

/**
 * What an empty panel should say. `absent` — the real "there is nothing here" —
 * is only ever shown once a request has actually come back saying so.
 */
function emptyNote(status: 'loading' | 'ready' | 'error', absent: string): string {
  if (status === 'loading') return 'Checking…';
  if (status === 'error') return 'Could not reach the dashboard service, so this may be out of date.';
  return absent;
}

function CalendarSection({ settings, people, night, say, onSettingsChange }: Props) {
  const [accounts, setAccounts] = useState<GoogleAccount[]>([]);
  const [calendars, setCalendars] = useState<SubscribedCalendar[]>([]);
  const [configured, setConfigured] = useState(true);
  const [syncing, setSyncing] = useState(false);
  /**
   * An empty list is not the same claim as an unanswered one. Until the fetch
   * lands we know nothing, and saying "no account connected" would be inventing
   * an answer — the reading that sends someone to Settings to reconnect an
   * account that was there the whole time.
   */
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    try {
      const data = await api.calendars();
      setAccounts(data.accounts);
      setCalendars(data.calendars);
      setConfigured(data.configured);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async () => {
    try {
      const { url } = await api.googleAuthUrl();
      // Google's consent screen refuses to render in an iframe, so this has to
      // be a real window. On a kiosk it opens in the same tab and comes back.
      const popup = window.open(url, 'google-auth', 'width=520,height=680');
      if (!popup) {
        window.location.href = url;
        return;
      }
      const timer = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(timer);
          void load();
        }
      }, 800);
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not start Google sign-in', 25);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await api.syncCalendars();
      say(`Synced ${res.calendars} calendars`, 148);
      await load();
    } catch (err) {
      say(err instanceof Error ? err.message : 'Sync failed', 25);
    } finally {
      setSyncing(false);
    }
  };

  const patchSettings = async (patch: Partial<Settings>) => {
    onSettingsChange({ ...settings, ...patch });
    try {
      onSettingsChange(await api.updateSettings(patch));
    } catch (err) {
      onSettingsChange(settings);
      say(err instanceof Error ? err.message : 'Could not save', 25);
    }
  };

  return (
    <>
      <Panel
        title="Google accounts"
        sub={
          configured
            ? 'Sign in to pull in every calendar on the account'
            : 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server, then restart it'
        }
        addLabel={configured ? '+ Add a Google account' : undefined}
        onAdd={status === 'ready' && configured ? () => void connect() : undefined}
      >
        {accounts.map((account) => (
          <div key={account.id} style={rowStyle}>
            <span
              style={{
                flex: 'none',
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: account.error ? col(25, night) : col(148, night),
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {account.email}
              </div>
              <div style={{ fontSize: 14.5, color: 'var(--ink2)', fontWeight: 600 }}>
                {account.error
                  ? account.error
                  : account.lastSyncAt
                    ? `Signed in · synced ${relative(account.lastSyncAt)}`
                    : 'Signed in'}
              </div>
            </div>
            <Button
              onClick={async () => {
                await api.disconnectAccount(account.id);
                say(`${account.email} disconnected`, 25);
                await load();
              }}
              style={{ flex: 'none' }}
            >
              Disconnect
            </Button>
          </div>
        ))}
        {accounts.length === 0 && (
          <div style={{ padding: '6px 2px', color: 'var(--ink2)', fontWeight: 700 }}>
            {emptyNote(status, 'No Google account connected yet.')}
          </div>
        )}
        {accounts.length > 0 && (
          <Button onClick={() => void sync()} style={{ alignSelf: 'flex-start' }}>
            <Icon name="sync" size={17} />
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
        )}
      </Panel>

      <Panel
        title="Subscribed calendars"
        sub="Assign a calendar to a person to give its events their color"
        delay={60}
      >
        {calendars.map((cal) => (
          <div key={cal.id} style={{ ...rowStyle, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{cal.summary}</div>
              <div style={{ fontSize: 14.5, color: 'var(--ink2)', fontWeight: 600 }}>
                {cal.readOnly ? 'Read only' : 'Read + write'}
                {cal.primary && ' · primary'}
              </div>
            </div>

            <select
              value={cal.personId ?? ''}
              onChange={async (e) => {
                const personId = e.target.value || null;
                setCalendars((cs) => cs.map((c) => (c.id === cal.id ? { ...c, personId } : c)));
                await api.updateCalendar(cal.id, { personId });
              }}
              style={selectStyle}
            >
              <option value="">Unassigned</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <Switch
              night={night}
              on={cal.enabled}
              onChange={async (enabled) => {
                setCalendars((cs) => cs.map((c) => (c.id === cal.id ? { ...c, enabled } : c)));
                await api.updateCalendar(cal.id, { enabled });
              }}
            />
          </div>
        ))}
        {calendars.length === 0 && (
          <div style={{ padding: '6px 2px', color: 'var(--ink2)', fontWeight: 700 }}>
            {emptyNote(status, 'Connect an account to see its calendars.')}
          </div>
        )}
      </Panel>

      <Panel title="Display" delay={120}>
        <ChipRow
          label="Week starts on"
          options={['Sunday', 'Monday'] as const}
          value={settings.weekStart}
          onChange={(weekStart) => void patchSettings({ weekStart })}
        />
        <ChipRow
          label="Day view hours"
          options={['6a – 10p', '7a – 9p', 'All 24'] as const}
          value={settings.dayHours}
          onChange={(dayHours) => void patchSettings({ dayHours })}
        />
        <ToggleRow
          night={night}
          label="Show the all-day row"
          on={settings.showAllDay}
          onChange={(showAllDay) => void patchSettings({ showAllDay })}
        />
        <ToggleRow
          night={night}
          label="Show family birthdays"
          sub="An all-day event on everyone's big day"
          on={settings.birthdaysOnCal}
          onChange={(birthdaysOnCal) => void patchSettings({ birthdaysOnCal })}
        />
      </Panel>
    </>
  );
}

function relative(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// ---------- chores ----------

function ChoresSection({
  people,
  board,
  settings,
  night,
  say,
  onSettingsChange,
  onPeopleChange,
  onBoardChange,
  onEditChore,
}: Props) {
  const patchSettings = async (patch: Partial<Settings>) => {
    onSettingsChange({ ...settings, ...patch });
    try {
      onSettingsChange(await api.updateSettings(patch));
    } catch (err) {
      onSettingsChange(settings);
      say(err instanceof Error ? err.message : 'Could not save', 25);
    }
  };

  return (
    <>
      <Panel title="Board behavior">
        <ChipRow
          label="Board resets"
          options={['Every night', 'Sunday', 'Monday'] as const}
          value={settings.choreReset}
          onChange={(choreReset) => void patchSettings({ choreReset })}
        />
        <ToggleRow
          night={night}
          label="Celebrate a cleared board"
          sub="Confetti and a cheer when someone finishes"
          on={settings.choreConfetti}
          onChange={(choreConfetti) => void patchSettings({ choreConfetti })}
        />
      </Panel>

      <Panel
        title="Chore boards"
        delay={40}
        sub="Parents can be left off entirely. Pause a streak while someone is away and it neither grows nor breaks."
      >
        {people.map((p) => {
          const streak = board.streaks.find((s) => s.personId === p.id);
          const points = board.points.find((pt) => pt.personId === p.id)?.points ?? 0;
          const streakNote = streak?.paused
            ? `paused at ${streak.length} in a row`
            : streak?.length
              ? `${streak.length} in a row`
              : 'no streak yet';
          return (
            <div key={p.id} style={{ ...rowStyle, flexWrap: 'wrap', gap: '12px 16px' }}>
              <Avatar name={p.name} hue={p.hue} night={night} size={44} avatarUrl={p.avatarUrl} avatarKey={p.avatarKey} ring />
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{p.name}</div>
                <div style={{ fontSize: 14.5, color: 'var(--ink2)', fontWeight: 600 }}>
                  {points} pts{p.onChores && ` · ${streakNote}`}
                </div>
              </div>
              <SwitchCell
                caption="Board"
                night={night}
                label={`Give ${p.name} a chore board`}
                on={p.onChores}
                onChange={async (onChores) => {
                  try {
                    await api.updatePerson(p.id, { onChores });
                    await onPeopleChange();
                  } catch (err) {
                    say(err instanceof Error ? err.message : 'Could not save', 25);
                  }
                }}
              />
              {/* Reads as "the streak is running", so both toggles mean the
                  same thing when they are on. Someone with no board has no
                  streak to run, so theirs is shown but cannot be moved. */}
              <SwitchCell
                caption="Streak"
                night={night}
                label={`Keep ${p.name}'s streak running`}
                disabled={!p.onChores}
                on={p.onChores && !streak?.paused}
                onChange={async (running) => {
                  try {
                    await api.setStreakPaused(p.id, !running);
                    await onBoardChange();
                    say(running ? `${p.name}'s streak resumes` : `${p.name}'s streak is paused`, p.hue);
                  } catch (err) {
                    say(err instanceof Error ? err.message : 'Could not save', 25);
                  }
                }}
              />
            </div>
          );
        })}
      </Panel>

      <ChoreListPanel
        people={people}
        night={night}
        say={say}
        onEditChore={onEditChore}
        version={board}
      />

    </>
  );
}

/** A switch under its own caption, for rows that carry more than one. */
function SwitchCell({
  caption,
  on,
  night,
  label,
  disabled,
  onChange,
}: {
  caption: string;
  on: boolean;
  night: boolean;
  label: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
      <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink2)', letterSpacing: 0.2 }}>
        {caption}
      </span>
      <Switch night={night} on={on} label={label} disabled={disabled} onChange={onChange} />
    </div>
  );
}

/**
 * Every chore, once, with the faces it belongs to.
 *
 * One row per chore rather than one per assignee: a chore shared by three kids
 * is a single thing to edit, and listing it three times invited the reading
 * that each copy could be changed on its own.
 *
 * It reads the full list rather than the board, so a Weekly chore is still
 * editable on the days it isn't due. `version` is whatever the caller changes
 * when a chore is saved or deleted — it's the cue to re-read.
 */
function ChoreListPanel({
  people,
  night,
  say,
  onEditChore,
  version,
}: {
  people: Person[];
  night: boolean;
  say: (text: string, hue?: number) => void;
  onEditChore: (chore: Chore | null) => void;
  version: unknown;
}) {
  const [chores, setChores] = useState<Chore[]>([]);

  useEffect(() => {
    void api
      .allChores()
      .then(setChores)
      .catch((err) => say(err instanceof Error ? err.message : 'Could not load the chores', 25));
  }, [version, say]);

  return (
    <Panel
      title="Chores"
      sub="Tap one to edit its instructions, who it belongs to, or to delete it"
      addLabel="+ New chore"
      onAdd={() => onEditChore(null)}
      delay={80}
    >
      {chores.map((chore) => {
        // A chore can outlive the person it was assigned to, and it still has
        // to be reachable here — otherwise it is invisible and undeletable.
        const assigned = chore.personIds
          .map((id) => people.find((p) => p.id === id))
          .filter((p): p is Person => Boolean(p));
        return (
          <ItemRow
            key={chore.id}
            label={chore.title}
            sub={
              assigned.length === 0
                ? 'Nobody assigned'
                : [assigned.map((p) => p.name).join(', '), chore.description].filter(Boolean).join(' · ')
            }
            leading={<AvatarStack people={assigned} night={night} />}
            tag={describeRecurrence(chore.recurrence)}
            onClick={() => onEditChore(chore)}
          />
        );
      })}

      {chores.length === 0 && (
        <div style={{ padding: '6px 2px', color: 'var(--ink2)', fontWeight: 700 }}>
          No chores yet. Add the first one below.
        </div>
      )}
    </Panel>
  );
}

/** Overlapping faces for whoever a chore belongs to. */
function AvatarStack({ people, night }: { people: Person[]; night: boolean }) {
  const SHOWN = 4;
  const shown = people.slice(0, SHOWN);
  const extra = people.length - shown.length;

  // Nothing to show, but the row still needs its leading column to line up
  // with every other row in the list.
  if (people.length === 0) {
    return (
      <span
        aria-hidden="true"
        style={{
          flex: 'none',
          width: 38,
          height: 38,
          borderRadius: '50%',
          border: '1.5px dashed var(--line)',
        }}
      />
    );
  }

  return (
    <span
      style={{ flex: 'none', display: 'flex', alignItems: 'center' }}
      aria-label={people.map((p) => p.name).join(', ')}
    >
      {shown.map((p, i) => (
        // Each face sits on top of the one before, so the ring reads as an
        // edge rather than the faces blurring into one shape.
        <span
          key={p.id}
          style={{
            marginLeft: i === 0 ? 0 : -11,
            borderRadius: '50%',
            boxShadow: '0 0 0 2.5px var(--card)',
            display: 'flex',
          }}
        >
          <Avatar
            name={p.name}
            hue={p.hue}
            night={night}
            size={38}
            avatarUrl={p.avatarUrl}
            avatarKey={p.avatarKey}
          />
        </span>
      ))}
      {extra > 0 && (
        <span
          style={{
            marginLeft: -11,
            width: 38,
            height: 38,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--chip)',
            color: 'var(--ink2)',
            fontSize: 14,
            fontWeight: 800,
            boxShadow: '0 0 0 2.5px var(--card)',
          }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

// ---------- points ----------

/** What each kind of ledger entry is called in front of a parent. */
const LEDGER_KIND: Record<PointEvent['refType'], string> = {
  claim: 'Extra job',
  redemption: 'Reward claimed',
  manual: 'Manual adjustment',
};

/**
 * Everything that moves a balance, in the order points travel: earned on an
 * extra job, spent on a reward, recorded on the ledger.
 *
 * Chores are deliberately not here — they are the baseline expectation and pay
 * nothing, so the only work in this section is work that pays.
 */
function PointsSection({
  people,
  board,
  settings,
  night,
  say,
  onSettingsChange,
  onEditExtra,
  onEditReward,
  onBoardChange,
}: Props) {
  const patchSettings = async (patch: Partial<Settings>) => {
    onSettingsChange({ ...settings, ...patch });
    try {
      onSettingsChange(await api.updateSettings(patch));
    } catch (err) {
      onSettingsChange(settings);
      say(err instanceof Error ? err.message : 'Could not save', 25);
    }
  };

  return (
    <>
      <Panel
        title="Extra jobs"
        sub="The only work that earns — kids pick these up for points"
        addLabel="+ New extra job"
        onAdd={() => onEditExtra(null)}
      >
        {board.extras.map((extra) => (
          <ItemRow
            key={extra.id}
            label={extra.title}
            tag={`+${extra.points}`}
            tagStyle={{ background: soft(68, night), color: deep(68, night) }}
            onClick={() => onEditExtra(extra)}
          />
        ))}
        {board.extras.length === 0 && (
          <div style={{ padding: '6px 2px', color: 'var(--ink2)', fontWeight: 700 }}>
            No extra jobs yet. Add the first one below.
          </div>
        )}
        <ToggleRow
          night={night}
          label="Kids can claim extra jobs"
          sub="Extra jobs show in the kid's own list"
          on={settings.claimExtras}
          onChange={(claimExtras) => void patchSettings({ claimExtras })}
        />
      </Panel>

      <Panel
        title="Rewards"
        sub="Goals kids can save toward"
        addLabel="+ New reward"
        onAdd={() => onEditReward(null)}
        delay={40}
      >
        {board.rewards.map((reward) => (
          <ItemRow
            key={reward.id}
            label={reward.label}
            tag={`${reward.cost} pts`}
            tagStyle={{ background: soft(305, night), color: deep(305, night) }}
            onClick={() => onEditReward(reward)}
          />
        ))}
        {board.rewards.length === 0 && (
          <div style={{ padding: '6px 2px', color: 'var(--ink2)', fontWeight: 700 }}>
            No rewards yet. Add the first one below.
          </div>
        )}
      </Panel>

      <LedgerPanel people={people} night={night} say={say} onBoardChange={onBoardChange} />
    </>
  );
}

/**
 * One person's points: what they have, how it got there, and a way to correct
 * it by hand.
 *
 * The ledger is read from the server rather than assembled from the board,
 * because the board only carries a balance and the most recent redemptions —
 * the history a parent needs to answer "where did those points go" lives in
 * `point_events` and nowhere else.
 */
function LedgerPanel({
  people,
  night,
  say,
  onBoardChange,
}: {
  people: Person[];
  night: boolean;
  say: (text: string, hue?: number) => void;
  onBoardChange: () => Promise<void>;
}) {
  const [personId, setPersonId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<PointLedger | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [adjusting, setAdjusting] = useState(false);

  // Whoever is selected has to stay someone who still exists, so deleting a
  // person cannot leave this panel reading an empty history forever.
  const selected = people.find((p) => p.id === personId) ?? people[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    let live = true;
    setStatus('loading');
    api
      .pointHistory(selected.id)
      .then((data) => {
        if (!live) return;
        setLedger(data);
        setStatus('ready');
      })
      .catch(() => live && setStatus('error'));
    return () => {
      live = false;
    };
  }, [selected]);

  /** Reports whether it saved, so the dialog stays open on a failure. */
  const adjust = async (delta: number, reason: string): Promise<boolean> => {
    if (!selected) return false;
    try {
      const next = await api.adjustPoints(selected.id, delta, reason || 'Manual adjustment');
      setLedger(next);
      setStatus('ready');
      // Every other balance on screen is the board's copy of this number.
      await onBoardChange();
      say(`${delta > 0 ? '+' : '−'}${Math.abs(delta)} for ${selected.name}`, selected.hue);
      return true;
    } catch (err) {
      say(err instanceof Error ? err.message : 'That did not save', 25);
      return false;
    }
  };

  if (people.length === 0) {
    return (
      <Panel title="History" sub="Add someone in Family first" delay={80}>
        <div style={{ padding: '6px 2px', color: 'var(--ink2)', fontWeight: 700 }}>Nobody to show yet.</div>
      </Panel>
    );
  }

  return (
    <Panel
      title="History"
      sub="Everything that has moved this person's balance, newest first"
      delay={80}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {people.map((p) => {
          const on = p.id === selected?.id;
          return (
            <TapButton
              key={p.id}
              onClick={() => setPersonId(p.id)}
              aria-pressed={on}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                minHeight: 56,
                padding: '8px 16px 8px 8px',
                borderRadius: 18,
                border: `1px solid ${on ? 'transparent' : 'var(--line)'}`,
                background: on ? soft(p.hue, night) : 'transparent',
                color: on ? deep(p.hue, night) : 'var(--ink2)',
                fontSize: 16.5,
                fontWeight: 800,
              }}
            >
              <Avatar name={p.name} hue={p.hue} night={night} size={38} avatarUrl={p.avatarUrl} avatarKey={p.avatarKey} />
              {p.name}
            </TapButton>
          );
        })}
      </div>

      {selected && (
        <div style={rowStyle}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{selected.name}&rsquo;s balance</div>
            <div style={{ fontSize: 14.5, color: 'var(--ink2)', fontWeight: 600 }}>
              {status === 'ready' ? 'Sum of every entry below' : emptyNote(status, '')}
            </div>
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: deep(148, night) }}>
            {status === 'ready' && ledger ? `${ledger.points} pts` : '—'}
          </div>
        </div>
      )}

      {selected && (
        <div style={rowStyle}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>Adjust by hand</div>
            <div style={{ fontSize: 14.5, color: 'var(--ink2)', fontWeight: 600 }}>
              Goes on the history with today&rsquo;s date, so it can always be explained
            </div>
          </div>
          <Button
            variant="primary"
            disabled={status !== 'ready'}
            onClick={() => setAdjusting(true)}
            style={{ flex: 'none' }}
          >
            Adjust points
          </Button>
        </div>
      )}

      {status !== 'ready' && (
        <div style={{ padding: '6px 2px', color: 'var(--ink2)', fontWeight: 700 }}>
          {emptyNote(status, '')}
        </div>
      )}
      {status === 'ready' && ledger?.events.length === 0 && (
        <div style={{ padding: '6px 2px', color: 'var(--ink2)', fontWeight: 700 }}>
          Nothing has moved {selected?.name}&rsquo;s points yet.
        </div>
      )}
      {status === 'ready' &&
        ledger?.events.map((event) => {
          const up = event.delta > 0;
          return (
            <div key={event.id} style={rowStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{event.reason}</div>
                <div style={{ fontSize: 14.5, color: 'var(--ink2)', fontWeight: 600 }}>
                  {LEDGER_KIND[event.refType]} ·{' '}
                  <time dateTime={event.createdAt}>{stamp(event.createdAt)}</time>
                </div>
              </div>
              <div
                style={{
                  flex: 'none',
                  fontSize: 18,
                  fontWeight: 800,
                  color: up ? deep(148, night) : deep(25, night),
                }}
              >
                {up ? '+' : '−'}
                {Math.abs(event.delta)}
              </div>
            </div>
          );
        })}

      {adjusting && selected && (
        <AdjustPointsDialog
          person={selected}
          balance={ledger?.points ?? 0}
          night={night}
          onClose={() => setAdjusting(false)}
          onSave={adjust}
        />
      )}
    </Panel>
  );
}

/**
 * The manual adjustment, as a dialog.
 *
 * One signed number rather than an amount plus a direction: a parent taking
 * points away writes `-10`, which is also how it reads back on the ledger.
 */
function AdjustPointsDialog({
  person,
  balance,
  night,
  onClose,
  onSave,
}: {
  person: Person;
  balance: number;
  night: boolean;
  onClose: () => void;
  onSave: (delta: number, reason: string) => Promise<boolean>;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  // `-` on its own parses as NaN, which is what keeps Save disabled while
  // somebody is still typing the number after the sign.
  const delta = /^-?\d+$/.test(amount) ? Number(amount) : Number.NaN;
  const valid = Number.isInteger(delta) && delta !== 0;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    if (await onSave(delta, reason.trim())) onClose();
    else setSaving(false);
  };

  return (
    <Modal
      title={`Adjust ${person.name}'s points`}
      sub="A negative number takes points away"
      onClose={onClose}
      width={460}
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={() => void submit()} disabled={!valid || saving}>
            {saving ? 'Saving…' : 'Save adjustment'}
          </PrimaryButton>
        </>
      }
    >
      <Field label="Points" sub="For example 10, or -10 to take ten away">
        <input
          // `text`, not `number`: a number spinner on a wall tablet is a
          // three-pixel target, and it lets a stray `e` or `.` through.
          type="text"
          inputMode="text"
          autoComplete="off"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(signedDigits(e.target.value))}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          style={{ ...fieldStyle, fontSize: 22 }}
        />
      </Field>

      <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--ink2)' }}>
        {valid ? (
          <>
            {balance} → <span style={{ color: deep(delta > 0 ? 148 : 25, night) }}>{balance + delta}</span> pts
          </>
        ) : (
          <>Balance is {balance} pts</>
        )}
      </div>

      <Field label="Why" sub="Optional, but it is what makes the entry mean something later">
        <input
          type="text"
          placeholder="Manual adjustment"
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 200))}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          style={fieldStyle}
        />
      </Field>
    </Modal>
  );
}

/** Digits with at most one leading minus — anything else never reaches state. */
function signedDigits(raw: string): string {
  const negative = raw.trimStart().startsWith('-');
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  return digits || negative ? `${negative ? '-' : ''}${digits}` : '';
}

/** A ledger entry's moment, at the precision a parent actually reads. */
function stamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'Unknown date';
  return at.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: at.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ---------- display ----------

/** What this panel is running, and whether a newer release is waiting. */
function AboutPanel({ say }: { say: (text: string, hue?: number) => void }) {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    void api.version().then(setInfo).catch(() => undefined);
  }, []);

  const updater = info?.updater;
  const installing = updater?.state === 'requested' || updater?.state === 'running';

  /**
   * While an update runs, keep asking. The server is rebuilt out from under us
   * partway through, so failed requests are expected and ignored — the version
   * that answers afterwards is the answer.
   */
  useEffect(() => {
    if (!installing) return undefined;
    const timer = window.setInterval(() => {
      void api
        .version()
        .then(setInfo)
        .catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [installing]);

  if (!info) return null;
  const behind = info.available && info.available !== info.current;

  const detail = () => {
    if (installing) return updater?.message ?? 'Updating…';
    if (updater?.state === 'failed') return `Update failed: ${updater.message ?? 'unknown error'}`;
    if (info.error) return `Last check failed: ${info.error}`;
    if (behind) {
      return updater?.available
        ? `${info.available} is available`
        : `${info.available} is available — update from the machine running it`;
    }
    if (updater?.state === 'ok' && updater.tag === info.current) return `Updated to ${info.current}`;
    return info.checkedAt ? 'Up to date' : 'Checking for updates…';
  };

  return (
    <Panel title="This dashboard" sub="Version and updates" delay={60}>
      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div title={info.current} style={{ fontSize: 17, fontWeight: 800 }}>
            {/^v\d/.test(info.current) ? `Version ${info.current}` : displayVersion(info.current)}
          </div>
          <div style={{ fontSize: 14.5, color: 'var(--ink2)', fontWeight: 600 }}>{detail()}</div>
        </div>
        {behind && updater?.available && (
          <Button
            variant="primary"
            disabled={installing}
            onClick={async () => {
              if (!info.available) return;
              try {
                setInfo({ ...info, updater: await api.installUpdate(info.available) });
                say(`Installing ${info.available}`, 258);
              } catch (err) {
                say(err instanceof Error ? err.message : 'Could not start the update', 25);
              }
            }}
            style={{ flex: 'none' }}
          >
            {installing ? 'Updating…' : `Update to ${info.available}`}
          </Button>
        )}
        <Button
          disabled={installing}
          onClick={async () => {
            setChecking(true);
            try {
              setInfo(await api.checkVersion());
              say('Checked for updates', 148);
            } catch (err) {
              say(err instanceof Error ? err.message : 'Check failed', 25);
            } finally {
              setChecking(false);
            }
          }}
          style={{ flex: 'none' }}
        >
          {checking ? 'Checking…' : 'Check now'}
        </Button>
      </div>

      {behind && info.releaseUrl && (
        <a
          href={info.releaseUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            borderRadius: 16,
            border: '1px solid var(--line)',
            fontSize: 15.5,
            fontWeight: 800,
            color: 'var(--ink2)',
            textDecoration: 'none',
          }}
        >
          <Icon name="list" size={17} /> Release notes for {info.available}
        </a>
      )}
    </Panel>
  );
}

function DisplaySection({ settings, night, say, onSettingsChange }: Props) {
  const patchSettings = async (patch: Partial<Settings>) => {
    onSettingsChange({ ...settings, ...patch });
    try {
      onSettingsChange(await api.updateSettings(patch));
    } catch (err) {
      onSettingsChange(settings);
      say(err instanceof Error ? err.message : 'Could not save', 25);
    }
  };

  return (
    <>
      <Panel title="Screen">
      <ChipRow
        label="Theme"
        options={['Auto', 'Day', 'Night'] as const}
        value={settings.theme}
        onChange={(theme) => void patchSettings({ theme })}
      />
      <ChipRow
        label="Frame mode after"
        options={[1, 5, 15, 30] as const}
        value={settings.idleMin as 1 | 5 | 15 | 30}
        onChange={(idleMin) => void patchSettings({ idleMin })}
      />
      <ChipRow
        label="Navigation"
        options={['sidebar', 'tabs'] as const}
        value={settings.navModel}
        onChange={(navModel) => void patchSettings({ navModel })}
      />
      <ToggleRow
        night={night}
        label="Playful copy"
        sub="Warmer greetings and cheers"
        on={settings.playful}
        onChange={(playful) => void patchSettings({ playful })}
      />
      </Panel>
      <AboutPanel say={say} />
    </>
  );
}

// ---------- security ----------

function SecuritySection({ settings, say, onSettingsChange, onLock }: Props) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');

  const save = async () => {
    if (pin !== confirm) {
      say('Those PINs do not match', 25);
      return;
    }
    try {
      await api.setPin(pin);
      onSettingsChange({ ...settings, pinSet: true });
      setPin('');
      setConfirm('');
      say('Parent PIN saved', 148);
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not save the PIN', 25);
    }
  };

  return (
    <>
      <Panel
        title={settings.pinSet ? 'Change the parent PIN' : 'Set a parent PIN'}
        sub="Kids can always check chores off. The PIN covers everything in Settings: people, calendars, points, and rewards."
      >
        <input
          type="password"
          inputMode="numeric"
          placeholder="New PIN (4–8 digits)"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          style={inputStyle}
        />
        <input
          type="password"
          inputMode="numeric"
          placeholder="Confirm PIN"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
          style={inputStyle}
        />
        <Button
          variant="primary"
          size="lg"
          onClick={() => void save()}
          disabled={pin.length < 4}
          style={{ alignSelf: 'flex-start' }}
        >
          Save PIN
        </Button>
      </Panel>

      {settings.pinSet && (
        <Panel title="This screen" sub="Lock Settings again when you walk away" delay={60}>
          <Button onClick={onLock} style={{ alignSelf: 'flex-start' }}>
            <Icon name="lock" size={17} /> Lock now
          </Button>
          <Button
            danger
            onClick={async () => {
              await api.clearPin();
              onSettingsChange({ ...settings, pinSet: false });
              say('Parent PIN removed', 25);
            }}
            style={{ alignSelf: 'flex-start' }}
          >
            Remove the PIN
          </Button>
        </Panel>
      )}
      <Panel title="Backup" sub="Download a consistent copy of household data" delay={90}>
        <Button onClick={() => { window.location.href = '/api/backup'; }} style={{ alignSelf: 'flex-start' }}>
          Download SQLite backup
        </Button>
      </Panel>
    </>
  );
}

const selectStyle: React.CSSProperties = {
  flex: 'none',
  minHeight: 50,
  padding: '12px 16px',
  borderRadius: 16,
  border: '1px solid var(--line)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 16,
  fontWeight: 800,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 320,
  minHeight: 56,
  padding: '14px 18px',
  borderRadius: 16,
  border: '1px solid var(--line)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 19,
  fontWeight: 800,
  letterSpacing: 4,
  outline: 'none',
};
