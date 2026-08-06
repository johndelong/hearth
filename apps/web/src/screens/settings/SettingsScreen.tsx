import type {
  Chore,
  GoogleAccount,
  Person,
  Settings,
  SubscribedCalendar,
} from '@dashboard/shared';
import { useCallback, useEffect, useState } from 'react';
import { type Board, type VersionInfo, api } from '../../api';
import { displayVersion } from '../../components/UpdateNotice';
import { Avatar, Button, Icon, Switch, TapButton } from '../../components/ui';
import { EASE, type IconName, col, deep, soft } from '../../theme';
import { ChipRow, ItemRow, Panel, ToggleRow, rowStyle } from './controls';

export type SettingsSection = 'family' | 'calendar' | 'chores' | 'display' | 'security';

const SECTIONS: Array<{ id: SettingsSection; label: string; sub: string; icon: IconName }> = [
  { id: 'family', label: 'Family', sub: 'Everyone in the house', icon: 'star' },
  { id: 'calendar', label: 'Calendar', sub: 'Google accounts and subscriptions', icon: 'calendar' },
  { id: 'chores', label: 'Chores', sub: 'Boards, points, rewards', icon: 'check' },
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
    <div style={{ display: 'flex', gap: 20, height: '100%', minHeight: 0 }}>
      <nav
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

function CalendarSection({ settings, people, night, say, onSettingsChange }: Props) {
  const [accounts, setAccounts] = useState<GoogleAccount[]>([]);
  const [calendars, setCalendars] = useState<SubscribedCalendar[]>([]);
  const [configured, setConfigured] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.calendars();
      setAccounts(data.accounts);
      setCalendars(data.calendars);
      setConfigured(data.configured);
    } catch {
      /* the panel below shows the unconfigured state */
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
        onAdd={configured ? () => void connect() : undefined}
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
            No Google account connected yet.
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
            Connect an account to see its calendars.
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
  onEditExtra,
  onEditReward,
}: Props) {
  const patchSettings = async (patch: Partial<Settings>) => {
    onSettingsChange({ ...settings, ...patch });
    try {
      onSettingsChange(await api.updateSettings(patch));
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not save', 25);
    }
  };

  return (
    <>
      <Panel title="Who gets a chore board" sub="Parents can be left off entirely">
        {people.map((p) => (
            <div key={p.id} style={rowStyle}>
              <Avatar name={p.name} hue={p.hue} night={night} size={44} avatarUrl={p.avatarUrl} avatarKey={p.avatarKey} ring />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{p.name}</div>
                <div style={{ fontSize: 14.5, color: 'var(--ink2)', fontWeight: 600 }}>
                  {board.points.find((pt) => pt.personId === p.id)?.points ?? 0} pts
                </div>
              </div>
              <Switch
                night={night}
                on={p.onChores}
                onChange={async (onChores) => {
                  await api.updatePerson(p.id, { onChores });
                  await onPeopleChange();
                }}
              />
            </div>
          ))}
      </Panel>

      <Panel
        title="Streaks"
        sub="Pause someone while they're away, and the streak neither grows nor breaks"
        delay={40}
      >
        {people
          .filter((p) => p.onChores)
          .map((p) => {
            const streak = board.streaks.find((s) => s.personId === p.id);
            return (
              <div key={p.id} style={rowStyle}>
                <Avatar name={p.name} hue={p.hue} night={night} size={44} avatarUrl={p.avatarUrl} avatarKey={p.avatarKey} ring />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 800 }}>{p.name}</div>
                  <div style={{ fontSize: 14.5, color: 'var(--ink2)', fontWeight: 600 }}>
                    {streak?.paused
                      ? `Paused at ${streak.length} in a row`
                      : streak?.length
                        ? `${streak.length} in a row`
                        : 'No streak yet'}
                  </div>
                </div>
                <Switch
                  night={night}
                  label={`Pause ${p.name}'s streak`}
                  on={Boolean(streak?.paused)}
                  onChange={async (paused) => {
                    try {
                      await api.setStreakPaused(p.id, paused);
                      await onBoardChange();
                      say(paused ? `${p.name}'s streak is paused` : `${p.name}'s streak resumes`, p.hue);
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

      <Panel title="Board behavior" delay={60}>
        <ChipRow
          label="Board resets"
          options={['Every night', 'Sunday', 'Monday'] as const}
          value={settings.choreReset}
          onChange={(choreReset) => void patchSettings({ choreReset })}
        />
        <ToggleRow
          night={night}
          label="Kids can claim extra jobs"
          sub="Extra jobs show in the kid's own list"
          on={settings.claimExtras}
          onChange={(claimExtras) => void patchSettings({ claimExtras })}
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
        title="Extra jobs"
        sub="Kids pick these up for points"
        addLabel="+ New extra job"
        onAdd={() => onEditExtra(null)}
        delay={120}
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
      </Panel>

      <Panel
        title="Rewards"
        sub="Goals kids can save toward"
        addLabel="+ New reward"
        onAdd={() => onEditReward(null)}
        delay={180}
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
      </Panel>
    </>
  );
}

/**
 * The chore list, grouped by whose board it lands on.
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

  const boardPeople = people;
  // A chore assigned to nobody who still exists would otherwise never be listed.
  const orphans = chores.filter((c) => !c.personIds.some((id) => boardPeople.some((p) => p.id === id)));
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? 'Unknown';

  return (
    <Panel
      title="Chores"
      sub="Tap one to edit its instructions, who it belongs to, or to delete it"
      addLabel="+ New chore"
      onAdd={() => onEditChore(null)}
      delay={60}
    >
      {boardPeople.map((person) => {
        const mine = chores.filter((c) => c.personIds.includes(person.id));
        if (mine.length === 0) return null;
        return (
          <div key={person.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                marginTop: 4,
                fontSize: 15,
                fontWeight: 800,
                color: 'var(--ink2)',
              }}
            >
              <Avatar name={person.name} hue={person.hue} night={night} size={26} avatarUrl={person.avatarUrl} avatarKey={person.avatarKey} />
              {person.name}
              {!person.onChores && ' · board is off'}
            </div>
            {mine.map((chore) => {
              // The same chore is listed under each of its people, so say so —
              // otherwise editing it here looks like it edits only this copy.
              const others = chore.personIds.filter((id) => id !== person.id).map(nameOf);
              const shared = others.length ? `Shared with ${others.join(', ')}` : null;
              return (
                <ItemRow
                  key={chore.id}
                  label={chore.title}
                  sub={[shared, chore.description].filter(Boolean).join(' · ') || undefined}
                  tag={chore.repeat}
                  tagStyle={{ background: soft(person.hue, night), color: deep(person.hue, night) }}
                  onClick={() => onEditChore(chore)}
                />
              );
            })}
          </div>
        );
      })}

      {/* A chore whose person was deleted would otherwise be invisible forever. */}
      {orphans.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ marginTop: 4, fontSize: 15, fontWeight: 800, color: col(25, night) }}>
            Nobody assigned
          </div>
          {orphans.map((chore) => (
            <ItemRow key={chore.id} label={chore.title} tag={chore.repeat} onClick={() => onEditChore(chore)} />
          ))}
        </div>
      )}

      {chores.length === 0 && (
        <div style={{ padding: '6px 2px', color: 'var(--ink2)', fontWeight: 700 }}>
          No chores yet. Add the first one below.
        </div>
      )}
    </Panel>
  );
}

// ---------- display ----------

/** What this panel is running, and whether a newer release is waiting. */
function AboutPanel({ say }: { say: (text: string, hue?: number) => void }) {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    void api.version().then(setInfo).catch(() => undefined);
  }, []);

  if (!info) return null;
  const behind = info.available && info.available !== info.current;

  return (
    <Panel title="This dashboard" sub="Version and updates" delay={60}>
      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div title={info.current} style={{ fontSize: 17, fontWeight: 800 }}>
            {/^v\d/.test(info.current) ? `Version ${info.current}` : displayVersion(info.current)}
          </div>
          <div style={{ fontSize: 14.5, color: 'var(--ink2)', fontWeight: 600 }}>
            {info.error
              ? `Last check failed: ${info.error}`
              : behind
                ? `${info.available} is available — deploy it on the Mac mini`
                : info.checkedAt
                  ? 'Up to date'
                  : 'Checking for updates…'}
          </div>
        </div>
        <Button
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
