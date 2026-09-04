import { homeAlertActive, homeCategoryFor, homeDashboardAlertActive, type HomeCandidate, type HomeCategory, type HomeDashboard, type HomeDashboardItem, type HomeDashboardSelection, type HomeDeviceCandidate, type HomeEntityState } from '@dashboard/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject, type PointerEvent, type ReactNode } from 'react';
import { api } from '../../api';
import { Button, Card, Icon, Switch, TapButton } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { CARD_SHADOW, type IconName, deep, homeTone, soft } from '../../theme';
import { useOnWake } from '../../state';

const EMPTY: HomeDashboard = { connection: 'disconnected', stale: true, items: [] };
const CATEGORIES: Array<{ id: HomeCategory; label: string; icon: IconName; hue: number }> = [
  { id: 'security', label: 'Security & doors', icon: 'shield', hue: 25 },
  { id: 'covers', label: 'Covers', icon: 'shades', hue: 258 },
  { id: 'climate', label: 'Climate', icon: 'thermometer', hue: 196 },
  { id: 'lights', label: 'Lights', icon: 'bulb', hue: 68 },
  { id: 'batteries', label: 'Batteries', icon: 'battery', hue: 148 },
  { id: 'media', label: 'Media', icon: 'music', hue: 305 },
  { id: 'other', label: 'Other', icon: 'home', hue: -1 },
];

const categoryInfo = (id: HomeCategory) => CATEGORIES.find((category) => category.id === id)!;

const DASHBOARD_SECTIONS: Array<{ id: string; label: string; icon: IconName; hue: number; includes: (item: HomeDashboardItem) => boolean }> = [
  { id: 'alarm', label: 'Alarm', icon: 'shield', hue: 258, includes: (item) => item.domain === 'alarm_control_panel' },
  { id: 'security', label: 'Doors & locks', icon: 'door', hue: 258, includes: (item) => homeCategoryFor(item) === 'security' && item.domain !== 'alarm_control_panel' },
  { id: 'covers', label: 'Covers', icon: 'shades', hue: 305, includes: (item) => homeCategoryFor(item) === 'covers' },
  { id: 'climate', label: 'Climate', icon: 'thermometer', hue: 165, includes: (item) => homeCategoryFor(item) === 'climate' },
  { id: 'lights', label: 'Lights', icon: 'bulb', hue: 68, includes: (item) => item.domain === 'light' || (item.domain === 'switch' && homeCategoryFor(item) === 'lights') },
  { id: 'switches', label: 'Switches', icon: 'toggle', hue: 305, includes: (item) => ['switch', 'input_boolean', 'fan'].includes(item.domain) && homeCategoryFor(item) !== 'lights' },
  { id: 'batteries', label: 'Batteries', icon: 'battery', hue: 68, includes: (item) => homeCategoryFor(item) === 'batteries' },
  { id: 'media', label: 'Media', icon: 'music', hue: 305, includes: (item) => homeCategoryFor(item) === 'media' },
  { id: 'other', label: 'Sensors & other', icon: 'home', hue: 165, includes: (item) => homeCategoryFor(item) === 'other' && !['switch', 'input_boolean', 'fan'].includes(item.domain) },
];

export interface HomeEditActions {
  save: () => void;
  cancel: () => void;
}

export function HomeScreen({ edit, editActions, night, say, onCloseEdit }: {
  edit: boolean;
  editActions: MutableRefObject<HomeEditActions | null>;
  night: boolean;
  say: (text: string, hue?: number) => void;
  onCloseEdit: () => void;
}) {
  const [dashboard, setDashboard] = useState<HomeDashboard>(EMPTY);
  const [detailEntityId, setDetailEntityId] = useState<string | null>(null);
  const [busyEntityId, setBusyEntityId] = useState<string | null>(null);
  const load = useCallback(() => api.home().then(setDashboard).catch(() => undefined), []);

  useEffect(() => {
    void load();
    const events = new EventSource('/api/home/events');
    events.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data) as HomeDashboard;
        if (next && Array.isArray(next.items)) setDashboard(next);
      } catch {
        // EventSource reconnects automatically; the next complete state replaces this one.
      }
    };
    return () => events.close();
  }, [load]);
  useOnWake(() => void load());

  const detailItem = dashboard.items.find((item) => item.entityId === detailEntityId) ?? null;
  const runAction = async (item: HomeDashboardItem, action: string, value?: number) => {
    if (busyEntityId) return;
    setBusyEntityId(item.entityId);
    try {
      await api.homeAction(item.entityId, action, value);
    } catch (err) {
      await load();
      say(err instanceof Error ? err.message : 'Home Assistant action failed', 25);
    } finally {
      setBusyEntityId(null);
    }
  };

  if (edit) return <HomeEditor actions={editActions} night={night} say={say} onDone={() => { onCloseEdit(); void load(); }} />;

  if (dashboard.items.length === 0) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', color: 'var(--ink2)' }}>
        <div>
          <Icon name="home" size={52} style={{ opacity: 0.35 }} />
          <div style={{ marginTop: 16, fontSize: 23, fontWeight: 800, color: 'var(--ink)' }}>Your home, at a glance</div>
          <div style={{ marginTop: 7, fontSize: 16, fontWeight: 650 }}>
            {dashboard.connection === 'disconnected' ? 'Connect Home Assistant in Settings, then use Edit to choose devices.' : 'Use Edit to choose the devices shown here.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {dashboard.stale && (
        <div role="status" style={{ marginBottom: 14, padding: '11px 16px', borderRadius: 16, background: 'var(--chip)', color: 'var(--ink2)', fontWeight: 750 }}>
          Home Assistant is {dashboard.connection === 'connecting' ? 'reconnecting' : 'unavailable'} · showing last known states
        </div>
      )}
      <AttentionPanel items={dashboard.items} night={night} onOpen={(item) => setDetailEntityId(item.entityId)} />
      <HomeSummary items={dashboard.items} />
      <div className="home-sections">
        {DASHBOARD_SECTIONS.map((section) => {
          const items = dashboard.items.filter(section.includes);
          if (!items.length) return null;
          const active = items.filter(isVisuallyActive).length;
          const tone = homeTone(section.hue, night);
          return (
            <section key={section.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 2px 11px' }}>
                <span style={{ width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 12, background: tone.background, color: tone.ink }}><Icon name={section.icon} size={19} /></span>
                <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 650 }}>{section.label}</h2>
                <span style={{ color: 'var(--ink2)', fontSize: 15, fontWeight: 750 }}>{active ? `${active} active · ` : ''}{items.length}</span>
              </div>
              <div className={`home-grid${section.id === 'climate' ? ' home-grid-climate' : ''}`}>
                {items.map((item) => item.domain === 'climate'
                  ? <ClimateCard key={item.entityId} item={item} night={night} busy={busyEntityId === item.entityId} onOpen={() => setDetailEntityId(item.entityId)} onAction={(action, value) => void runAction(item, action, value)} />
                  : <HomeCard key={item.entityId} item={item} night={night} busy={busyEntityId === item.entityId} onOpen={() => setDetailEntityId(item.entityId)} onAction={(action, value) => void runAction(item, action, value)} />)}
              </div>
            </section>
          );
        })}
      </div>
      {detailItem && <HomeDetail item={detailItem} night={night} busy={busyEntityId === detailItem.entityId} onAction={(action, value) => void runAction(detailItem, action, value)} onClose={() => setDetailEntityId(null)} />}
    </div>
  );
}

function iconFor(item: Pick<HomeDashboardItem, 'name' | 'domain' | 'deviceClass' | 'state'>): IconName {
  if (item.domain === 'lock') return item.state === 'locked' ? 'lock' : 'lockOpen';
  if (item.domain === 'cover') return item.deviceClass === 'garage' ? 'garage' : 'shades';
  if (item.domain === 'climate' || item.deviceClass === 'temperature') return 'thermometer';
  if (item.deviceClass === 'battery') return 'battery';
  if (['door', 'window', 'opening', 'garage_door'].includes(item.deviceClass ?? '')) return 'door';
  if (item.deviceClass === 'moisture') return 'droplet';
  if (item.domain === 'light' || (item.domain === 'switch' && homeCategoryFor(item) === 'lights')) return 'bulb';
  if (['switch', 'input_boolean', 'fan'].includes(item.domain)) return 'toggle';
  if (item.domain === 'alarm_control_panel' || ['smoke', 'gas', 'moisture', 'safety'].includes(item.deviceClass ?? '')) return 'alert';
  if (['media_player', 'camera'].includes(item.domain)) return 'music';
  return 'home';
}

function isVisuallyActive(item: HomeDashboardItem): boolean {
  if (!item.available) return false;
  if (item.domain === 'lock') return item.state === 'locked';
  if (item.domain === 'alarm_control_panel') return item.state !== 'disarmed';
  if (item.domain === 'climate') return item.state !== 'off';
  return item.state === 'on' || ['open', 'opening', 'unlocked', 'triggered', 'heat', 'cool'].includes(item.state);
}

function prettyState(item: HomeEntityState): string {
  if (!item.available) return 'Unavailable';
  if (item.domain === 'binary_sensor') {
    if (['door', 'window', 'opening', 'garage_door'].includes(item.deviceClass ?? '')) return item.state === 'on' ? 'Open' : 'Closed';
    if (item.deviceClass === 'battery') return item.state === 'on' ? 'Low battery' : 'Battery okay';
    if (['smoke', 'gas', 'carbon_monoxide', 'moisture', 'problem', 'safety', 'tamper'].includes(item.deviceClass ?? '')) return item.state === 'on' ? 'Detected' : 'Clear';
    if (['motion', 'occupancy'].includes(item.deviceClass ?? '')) return item.state === 'on' ? 'Active' : 'Quiet';
  }
  if (item.domain === 'climate') return item.details.currentTemperature === null ? item.state : `${item.details.currentTemperature}°`;
  if (item.domain === 'cover' && item.details.position !== null && item.state !== 'closed') return `${item.details.position}% open`;
  if (homeCategoryFor(item) === 'batteries') return `${item.state}${item.unit ?? (Number.isFinite(Number(item.state)) ? '%' : '')}`;
  if (item.unit) return `${item.state} ${item.unit}`;
  return item.state.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function tileState(item: HomeDashboardItem): string {
  if (item.state === 'on' && item.details.brightness !== null) return `On · ${Math.round(item.details.brightness / 255 * 100)}%`;
  return prettyState(item);
}

function actionFor(item: HomeDashboardItem): { action: string; label: string; risky: boolean } | null {
  if (['light', 'switch', 'input_boolean', 'fan'].includes(item.domain)) {
    return item.state === 'on' ? { action: 'turn_off', label: 'Turn off', risky: false } : { action: 'turn_on', label: 'Turn on', risky: false };
  }
  if (item.domain === 'lock') return item.state === 'locked'
    ? { action: 'unlock', label: 'Unlock', risky: true }
    : { action: 'lock', label: 'Lock', risky: false };
  if (item.domain === 'cover') return ['open', 'opening'].includes(item.state)
    ? { action: 'close', label: 'Close', risky: false }
    : { action: 'open', label: 'Open', risky: true };
  if (item.domain === 'alarm_control_panel') return item.state === 'disarmed'
    ? { action: 'arm_away', label: 'Arm away', risky: true }
    : { action: 'disarm', label: 'Disarm', risky: true };
  if (item.domain === 'climate') return item.state === 'off'
    ? { action: 'turn_on', label: 'Turn on', risky: false }
    : { action: 'turn_off', label: 'Turn off', risky: false };
  if (item.domain === 'button') return { action: 'press', label: 'Run', risky: true };
  if (item.domain === 'scene' || item.domain === 'script') return { action: 'turn_on', label: 'Run', risky: true };
  return null;
}

function criticalLabel(entity: HomeEntityState): string {
  if (homeCategoryFor(entity) === 'batteries') {
    const level = Number.parseFloat(entity.state);
    return Number.isFinite(level) ? `Low battery ${level}${entity.unit ?? '%'}` : 'Low battery';
  }
  if (entity.domain === 'lock') return entity.state === 'jammed' ? 'Jammed' : 'Unlocked';
  if (entity.domain === 'alarm_control_panel') return entity.state === 'triggered' ? 'Alarm sounding' : 'Alarm pending';
  if (['door', 'window', 'opening', 'garage_door'].includes(entity.deviceClass ?? '')) return 'Open';
  if (entity.deviceClass === 'moisture') return 'Water detected';
  return prettyState(entity);
}

function criticalLabels(item: HomeDashboardItem): string[] {
  if (!homeDashboardAlertActive(item)) return [];
  return [...new Set([item, ...item.related].filter(homeAlertActive).map(criticalLabel))];
}

function attentionIconFor(item: HomeDashboardItem): IconName {
  const alert = [item, ...item.related].find(homeAlertActive) ?? item;
  return homeCategoryFor(alert) === 'batteries' ? 'batteryLow' : iconFor(alert);
}

function batteryFor(item: HomeDashboardItem): { entity: HomeEntityState; level: number | null } | null {
  const entity = homeCategoryFor(item) === 'batteries' ? item : item.related.find((related) => homeCategoryFor(related) === 'batteries');
  if (!entity) return null;
  const parsed = Number.parseFloat(entity.state);
  return { entity, level: Number.isFinite(parsed) ? parsed : item.details.batteryLevel };
}

function levelFor(item: HomeDashboardItem): number | null {
  if (item.details.brightness !== null) return Math.round(item.details.brightness / 255 * 100);
  return batteryFor(item)?.level ?? item.details.position;
}

function AttentionPanel({ items, night, onOpen }: { items: HomeDashboardItem[]; night: boolean; onOpen: (item: HomeDashboardItem) => void }) {
  const alerts = items.filter(homeDashboardAlertActive);
  if (!alerts.length) return null;
  const warning = homeTone(25, night);
  return (
    <section aria-label="Things that need attention" style={{ marginBottom: 22, padding: '17px 20px 19px', borderRadius: 24, background: warning.background }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--danger)', fontSize: 14, fontWeight: 900, letterSpacing: '.06em', textTransform: 'uppercase' }}>
        <Icon name="alert" size={18} />
        {alerts.length} {alerts.length === 1 ? 'thing needs' : 'things need'} attention
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
        {alerts.map((item) => (
          <TapButton key={item.entityId} title={`View ${item.displayName}`} onClick={() => onOpen(item)} style={{ minHeight: 48, padding: '9px 15px', display: 'flex', alignItems: 'center', gap: 10, borderRadius: 999, background: 'var(--card)', color: 'var(--ink)', boxShadow: '0 8px 20px -18px rgba(20,24,40,.65)', fontSize: 15.5, fontWeight: 825 }}>
            <Icon name={attentionIconFor(item)} size={19} style={{ color: 'var(--danger)' }} />
            <span>{item.displayName}</span>
          </TapButton>
        ))}
      </div>
    </section>
  );
}

function HomeSummary({ items }: { items: HomeDashboardItem[] }) {
  const summaries = [
    { icon: 'bulb' as IconName, value: items.filter((item) => homeCategoryFor(item) === 'lights' && item.state === 'on').length, label: 'lights on' },
    { icon: 'door' as IconName, value: items.filter((item) => ['open', 'opening', 'unlocked'].includes(item.state) || (item.domain === 'binary_sensor' && ['door', 'window', 'opening', 'garage_door'].includes(item.deviceClass ?? '') && item.state === 'on')).length, label: 'open' },
    { icon: 'lock' as IconName, value: items.filter((item) => item.domain === 'lock' && item.state === 'locked').length, label: 'locked' },
    { icon: 'thermometer' as IconName, value: items.filter((item) => item.domain === 'climate' && item.state !== 'off').length, label: 'running' },
  ];
  return (
    <div style={{ display: 'flex', gap: 9, overflowX: 'auto', paddingBottom: 24 }}>
      {summaries.map((summary) => (
        <div key={summary.label} style={{ flex: 'none', minHeight: 42, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 9, borderRadius: 999, background: 'var(--chip)', color: 'var(--ink2)', fontSize: 14.5, fontWeight: 750 }}>
          <Icon name={summary.icon} size={17} />
          <strong style={{ color: 'var(--ink)' }}>{summary.value}</strong> {summary.label}
        </div>
      ))}
    </div>
  );
}

interface HomeCardProps {
  item: HomeDashboardItem;
  night: boolean;
  busy: boolean;
  onOpen: () => void;
  onAction: (action: string, value?: number) => void;
}

function HomeCard({ item, night, busy, onOpen, onAction }: HomeCardProps) {
  const action = actionFor(item);
  const active = isVisuallyActive(item);
  const alerts = criticalLabels(item);
  const level = levelFor(item);
  const battery = batteryFor(item)?.level;
  const hue = visualHue(item);
  const tone = homeTone(hue, night);
  const warning = homeTone(25, night);
  return (
    <div className="home-device-card" style={{ border: alerts.length ? `1.5px solid ${warning.accent}` : '1px solid transparent', background: alerts.length ? warning.background : active ? tone.background : 'var(--card)', boxShadow: CARD_SHADOW, opacity: item.available ? 1 : .58 }}>
      <TapButton className="home-card-hit-area" title={`View ${item.displayName} details`} onClick={onOpen}><span /></TapButton>
      <div className="home-card-content">
        <TapButton disabled={!item.available || busy} title={action ? (action.risky ? `Open ${item.displayName} controls` : action.label) : `View ${item.displayName}`} onClick={() => { if (action && !action.risky) onAction(action.action); else onOpen(); }} style={{ pointerEvents: 'auto', width: 52, height: 52, display: 'grid', placeItems: 'center', borderRadius: 17, background: alerts.length ? warning.accent : active ? tone.accent : 'var(--chip)', color: alerts.length || active ? '#fff' : 'var(--ink2)' }}>
          <Icon name={iconFor(item)} size={24} />
        </TapButton>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16.5, fontWeight: 850, color: !alerts.length && active ? tone.ink : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.displayName}</div>
          <div style={{ marginTop: 3, fontSize: 14.5, lineHeight: 1.2, fontWeight: 800, color: alerts.length ? warning.ink : active ? tone.ink : 'var(--ink2)' }}>{alerts.length ? alerts.join(' · ') : tileState(item)}</div>
          {(item.area || !item.available) && <div style={{ marginTop: 2, fontSize: 13.5, fontWeight: 650, color: 'var(--ink2)', opacity: 0.75 }}>{item.available ? item.area : 'Not responding'}</div>}
        </div>
      </div>
      <div style={{ flex: 1 }} />
      {level !== null && (
        <div aria-label={`${level} percent`} style={{ position: 'relative', zIndex: 1, pointerEvents: 'none', height: 8, borderRadius: 999, overflow: 'hidden', background: 'var(--line)' }}>
          <div style={{ height: '100%', width: `${Math.max(3, Math.min(100, level))}%`, borderRadius: 999, background: battery != null && battery <= 20 ? warning.accent : tone.accent }} />
        </div>
      )}
    </div>
  );
}

function visualHue(item: HomeDashboardItem): number {
  if (item.domain === 'alarm_control_panel' || homeCategoryFor(item) === 'security') return 258;
  if (homeCategoryFor(item) === 'covers' || homeCategoryFor(item) === 'media') return 305;
  if (homeCategoryFor(item) === 'climate' || homeCategoryFor(item) === 'other') return 165;
  if (item.domain === 'light' || homeCategoryFor(item) === 'lights' || homeCategoryFor(item) === 'batteries') return 68;
  if (['switch', 'input_boolean', 'fan'].includes(item.domain)) return 305;
  return -1;
}

function ClimateCard({ item, night, busy, onOpen, onAction }: HomeCardProps) {
  const current = item.details.currentTemperature ?? Number.parseFloat(item.related.find((entity) => entity.deviceClass === 'temperature')?.state ?? '');
  const humidity = item.details.humidity ?? Number.parseFloat(item.related.find((entity) => entity.deviceClass === 'humidity')?.state ?? '');
  const target = item.details.targetTemperature;
  const active = isVisuallyActive(item);
  const mode = item.state === 'heat' ? 'heat' : item.state === 'cool' ? 'cool' : item.state === 'off' ? 'off' : 'idle';
  const hue = mode === 'heat' ? 55 : mode === 'cool' ? 245 : 165;
  const tone = homeTone(hue, night);
  const accent = mode === 'off' ? 'var(--ink2)' : tone.accent;
  const sweep = target === null ? 0 : Math.max(0, Math.min(270, (target - 55) / 30 * 270));
  const status = mode === 'heat' ? 'Heating' : mode === 'cool' ? 'Cooling' : mode === 'off' ? 'Off' : 'At target';
  const statusIcon: IconName = mode === 'heat' ? 'flame' : mode === 'cool' ? 'snow' : mode === 'off' ? 'power' : 'check';
  return (
    <div className="home-climate-card" style={{ boxShadow: CARD_SHADOW, opacity: item.available ? 1 : .58 }}>
      <TapButton className="home-card-hit-area" title={`View ${item.displayName} details`} onClick={onOpen}><span /></TapButton>
      <div className="home-climate-header">
        <div><div style={{ fontSize: 20, fontWeight: 850 }}>{item.displayName}</div><div style={{ marginTop: 3, color: 'var(--ink2)', fontSize: 15, fontWeight: 700 }}>{target === null ? 'Off' : `${mode === 'cool' ? 'Cool' : mode === 'heat' ? 'Heat' : 'Set'} to ${target}°`}</div></div>
        <div style={{ minHeight: 36, padding: '0 13px', display: 'flex', alignItems: 'center', gap: 7, borderRadius: 999, background: mode === 'off' ? 'var(--chip)' : tone.background, color: mode === 'off' ? 'var(--ink2)' : tone.ink, fontWeight: 825 }}><Icon name={statusIcon} size={17} />{status}</div>
      </div>
      <div className="home-climate-dial-wrap">
        <div className="home-climate-dial" style={{ background: `conic-gradient(from 225deg, ${mode === 'off' ? 'var(--line)' : accent} 0deg ${sweep}deg, var(--line) ${sweep}deg 270deg, transparent 270deg 360deg)` }}>
          <div className="home-climate-dial-inner">
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-hero)', lineHeight: 1, fontWeight: 650 }}>{Number.isFinite(current) ? `${current}°` : '—'}</div>
            <div style={{ marginTop: 8, color: 'var(--ink2)', fontSize: 14, fontWeight: 750 }}>{target === null ? 'Off' : mode === 'heat' ? `Heating to ${target}°` : mode === 'cool' ? `Cooling to ${target}°` : `Holding ${target}°`}</div>
          </div>
        </div>
      </div>
      <div className="home-climate-controls">
        <ClimateButton label={`Lower ${item.displayName} temperature`} disabled={!item.available || busy || target === null} onClick={() => { if (target !== null) onAction('set_temperature', target - 1); }}>−</ClimateButton>
        <div style={{ textAlign: 'center', color: 'var(--ink2)', fontSize: 13, fontWeight: 750 }}><strong style={{ display: 'block', color: mode === 'off' ? 'var(--ink2)' : tone.ink, fontSize: 21 }}>{target === null ? '—' : `${target}°`}</strong>{Number.isFinite(humidity) ? `${humidity}% humidity` : item.area ?? ''}</div>
        <ClimateButton label={`Raise ${item.displayName} temperature`} disabled={!item.available || busy || target === null} onClick={() => { if (target !== null) onAction('set_temperature', target + 1); }}>+</ClimateButton>
        <ClimateButton label={`${active ? 'Turn off' : 'Turn on'} ${item.displayName}`} disabled={!item.available || busy} active={mode === 'off'} onClick={() => onAction(active ? 'turn_off' : 'turn_on')}><Icon name="power" size={23} /></ClimateButton>
      </div>
    </div>
  );
}

function ClimateButton({ label, disabled, active = false, onClick, children }: { label: string; disabled: boolean; active?: boolean; onClick: () => void; children: ReactNode }) {
  return <TapButton title={label} disabled={disabled} onClick={onClick} style={{ width: 'var(--control-xl)', height: 'var(--control-xl)', display: 'grid', placeItems: 'center', borderRadius: '50%', background: active ? 'var(--ink2)' : 'var(--chip)', color: active ? 'var(--card)' : 'var(--ink)', fontSize: 27, fontWeight: 500 }}>{children}</TapButton>;
}

function HomeLevelControl({ value, night, disabled, onToggle, onCommit }: { value: number; night: boolean; disabled: boolean; onToggle: () => void; onCommit: (value: number) => void }) {
  const [level, setLevel] = useState(value);
  const trackRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ pointerId: number; startX: number; moved: boolean } | null>(null);
  const levelRef = useRef(value);

  useEffect(() => {
    if (!gesture.current) {
      setLevel(value);
      levelRef.current = value;
    }
  }, [value]);

  const levelAt = (clientX: number) => {
    const bounds = trackRef.current?.getBoundingClientRect();
    if (!bounds) return levelRef.current;
    return Math.max(0, Math.min(100, Math.round(((clientX - bounds.left - 56) / Math.max(1, bounds.width - 112)) * 20) * 5));
  };
  const update = (clientX: number) => {
    const next = levelAt(clientX);
    levelRef.current = next;
    setLevel(next);
    return next;
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { pointerId: event.pointerId, startX: event.clientX, moved: false };
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - current.startX) >= 8) current.moved = true;
    if (current.moved) update(event.clientX);
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.moved) onCommit(update(event.clientX));
    else onToggle();
    gesture.current = null;
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 100 : Math.max(0, Math.min(100, levelRef.current + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 5 : -5)));
    levelRef.current = next;
    setLevel(next);
    onCommit(next);
  };
  const fraction = level / 100;
  const tone = homeTone(68, night);
  return (
    <div>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={level}
        aria-disabled={disabled}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => { gesture.current = null; setLevel(value); levelRef.current = value; }}
        onKeyDown={keyDown}
        style={{ position: 'relative', height: 112, borderRadius: 56, overflow: 'hidden', touchAction: 'none', cursor: disabled ? 'default' : 'pointer', background: 'var(--chip)', boxShadow: 'inset 0 0 0 1px var(--line)', opacity: disabled ? .55 : 1 }}
      >
        <div style={{ position: 'absolute', inset: 0, width: `calc(112px + (100% - 112px) * ${fraction})`, borderRadius: 56, background: tone.accent, transition: gesture.current ? 'none' : 'width 160ms ease' }} />
        <div style={{ position: 'absolute', top: 10, left: `calc(10px + (100% - 112px) * ${fraction})`, width: 92, height: 92, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'var(--card)', color: tone.ink, boxShadow: '0 7px 18px rgba(20,24,40,.18)', transition: gesture.current ? 'none' : 'left 160ms ease', fontSize: 18, fontWeight: 850 }}>{level}%</div>
      </div>
      <div style={{ marginTop: 9, textAlign: 'center', color: 'var(--ink2)', fontSize: 13.5, fontWeight: 700 }}>Tap to toggle · slide left or right to set</div>
    </div>
  );
}

function HomeDetail({ item, night, busy, onAction, onClose }: Omit<HomeCardProps, 'onOpen'> & { onClose: () => void }) {
  const brightness = item.details.brightness === null ? null : Math.round(item.details.brightness / 255 * 100);
  const action = actionFor(item);
  const battery = batteryFor(item);
  const tone = homeTone(visualHue(item), night);
  const warning = homeTone(25, night);
  const facts = [
    item.area ? ['Area', item.area] : null,
    battery ? ['Battery', battery.level === null ? prettyState(battery.entity) : `${battery.level}${battery.entity.unit ?? '%'}`] : null,
    item.lastChanged ? ['Last changed', relativeTime(item.lastChanged)] : null,
    ['Entity', item.entityId],
  ].filter((fact): fact is string[] => Boolean(fact));
  return (
    <Modal title={item.displayName} sub={[prettyState(item), item.area].filter(Boolean).join(' · ')} onClose={onClose} width={820} footer={<Button onClick={onClose}>Close</Button>}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '4px 0 8px' }}>
        <div style={{ width: 64, height: 64, display: 'grid', placeItems: 'center', borderRadius: 20, background: criticalLabels(item).length ? warning.accent : isVisuallyActive(item) ? tone.accent : 'var(--chip)', color: criticalLabels(item).length || isVisuallyActive(item) ? '#fff' : 'var(--ink2)' }}><Icon name={iconFor(item)} size={31} /></div>
        <div><div style={{ fontSize: 18, fontWeight: 850, color: criticalLabels(item).length ? 'var(--danger)' : 'var(--ink)' }}>{criticalLabels(item).join(' · ') || prettyState(item)}</div><div style={{ marginTop: 3, color: 'var(--ink2)', fontWeight: 700 }}>{item.available ? 'Connected' : 'Not responding'}</div></div>
      </div>

      {brightness !== null && (
        <HomeLevelControl value={brightness} night={night} disabled={busy || !item.available} onToggle={() => action && onAction(action.action)} onCommit={(value) => onAction('set_brightness', value)} />
      )}

      {item.domain === 'climate' && item.details.targetTemperature !== null && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12 }}>
          <Button disabled={busy || !item.available} onClick={() => onAction('set_temperature', item.details.targetTemperature! - 1)} style={{ minHeight: 52, fontSize: 22 }}>−</Button>
          <strong style={{ fontSize: 22 }}>{item.details.targetTemperature}°</strong>
          <Button disabled={busy || !item.available} onClick={() => onAction('set_temperature', item.details.targetTemperature! + 1)} style={{ minHeight: 52, fontSize: 22 }}>+</Button>
        </div>
      )}

      {item.domain === 'cover' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <Button danger={!['open', 'opening'].includes(item.state)} disabled={busy || !item.available} onClick={() => onAction('open')}>Open</Button>
          <Button disabled={busy || !item.available} onClick={() => onAction('stop')}>Stop</Button>
          <Button disabled={busy || !item.available} onClick={() => onAction('close')}>Close</Button>
        </div>
      ) : action && brightness === null && (
        <Button danger={action.risky && ['lock', 'cover', 'alarm_control_panel'].includes(item.domain)} disabled={busy || !item.available} onClick={() => onAction(action.action)} style={{ width: '100%', minHeight: 54, borderColor: action.risky && ['lock', 'cover', 'alarm_control_panel'].includes(item.domain) ? 'var(--danger)' : undefined }}>
          {busy ? 'Working…' : action.label}
        </Button>
      )}

      <div style={{ height: 1, background: 'var(--line)', marginTop: 4 }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 34px' }}>
        {facts.map(([label, value]) => <div key={label}><div style={{ color: 'var(--ink2)', fontSize: 12.5, fontWeight: 850, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</div><div style={{ marginTop: 3, fontSize: 16, fontWeight: 800 }}>{value}</div></div>)}
      </div>
    </Modal>
  );
}

function relativeTime(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return 'Just now';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

interface EditingItem extends HomeDashboardSelection {
  sourceName: string;
  area: string | null;
  domain: string;
  deviceClass: string | null;
}

type PickerMode = 'devices' | 'actions' | 'entities';

function HomeEditor({ actions: editActions, night, say, onDone }: { actions: MutableRefObject<HomeEditActions | null>; night: boolean; say: (text: string, hue?: number) => void; onDone: () => void }) {
  const [entities, setEntities] = useState<HomeCandidate[]>([]);
  const [devices, setDevices] = useState<HomeDeviceCandidate[]>([]);
  const [items, setItems] = useState<EditingItem[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<HomeCategory | 'all'>('security');
  const [pickerMode, setPickerMode] = useState<PickerMode>('devices');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void Promise.all([api.homeEntities(), api.homeDevices(), api.home()]).then(([all, availableDevices, dashboard]) => {
      setEntities(all);
      setDevices(availableDevices);
      const byId = new Map(all.map((item) => [item.entityId, item]));
      setItems(dashboard.items.map((saved) => {
        const source = byId.get(saved.entityId);
        const device = availableDevices.find((candidate) => candidate.deviceId === saved.deviceId || candidate.primaryEntityId === saved.entityId);
        return {
          entityId: saved.entityId,
          deviceId: device?.deviceId ?? null,
          displayName: saved.displayName,
          frameAlert: saved.frameAlert,
          sourceName: device?.name ?? source?.name ?? saved.name,
          area: source?.area ?? saved.area,
          domain: source?.domain ?? saved.domain,
          deviceClass: source?.deviceClass ?? saved.deviceClass,
        };
      }));
    }).catch((err) => say(err instanceof Error ? err.message : 'Could not load Home Assistant entities', 25)).finally(() => setLoading(false));
  }, [say]);

  const selected = new Set(items.map((item) => item.entityId));
  const selectedDevices = new Set(items.map((item) => item.deviceId).filter(Boolean));
  const available = useMemo(() => entities.filter((entity) => {
    if (selected.has(entity.entityId)) return false;
    if (category !== 'all' && homeCategoryFor(entity) !== category) return false;
    const haystack = `${entity.name} ${entity.entityId} ${entity.area ?? ''}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  }).slice(0, 80), [entities, items, search, category]);
  const availableDevices = useMemo(() => devices.filter((device) => {
    if (selectedDevices.has(device.deviceId)) return false;
    if (category !== 'all' && device.category !== category) return false;
    const haystack = `${device.name} ${device.area ?? ''} ${device.manufacturer ?? ''} ${device.model ?? ''}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  }).slice(0, 80), [devices, items, search, category]);
  const actions = useMemo(() => available.filter((entity) => ['scene', 'script', 'button', 'input_boolean'].includes(entity.domain)), [available]);

  const move = (index: number, direction: -1 | 1) => setItems((current) => {
    const next = [...current];
    const target = index + direction;
    if (target < 0 || target >= next.length) return current;
    [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
  });

  const save = async () => {
    if (loading || saving) return;
    setSaving(true);
    try {
      await api.saveHomeDashboard(items.map(({ entityId, deviceId, frameAlert }) => ({ entityId, deviceId: deviceId ?? null, displayName: null, frameAlert })));
      say('Home dashboard saved', 148);
      onDone();
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not save the Home dashboard', 25);
    } finally {
      setSaving(false);
    }
  };

  editActions.current = { save: () => void save(), cancel: onDone };

  if (loading) return <div style={{ padding: 30, color: 'var(--ink2)', fontWeight: 750 }}>Loading devices…</div>;

  return (
    <div style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Card padding="20px 22px">
        <div style={{ fontSize: 19, fontWeight: 850, marginBottom: 12 }}>Shown on Home</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((item, index) => (
            <div key={item.entityId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, border: '1px solid var(--line)', borderRadius: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 4 }}>
                <Button size="sm" disabled={index === 0} onClick={() => move(index, -1)}>↑</Button>
                <Button size="sm" disabled={index === items.length - 1} onClick={() => move(index, 1)}>↓</Button>
              </div>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 118, color: 'var(--ink2)', fontSize: 13.5, fontWeight: 800 }}>
                <Icon name={categoryInfo(homeCategoryFor({ ...item, name: item.sourceName })).icon} size={16} />
                {categoryInfo(homeCategoryFor({ ...item, name: item.sourceName })).label}
              </span>
              <span style={{ flex: '1 1 220px', minWidth: 0 }}>
                <span style={{ display: 'block', color: 'var(--ink)', fontSize: 16, fontWeight: 825, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.sourceName}</span>
                <span style={{ display: 'block', marginTop: 2, color: 'var(--ink2)', fontSize: 12.5, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.entityId}</span>
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 750, color: 'var(--ink2)' }}>
                Frame alert
                <Switch night={night} on={item.frameAlert} label={`Show ${item.sourceName} alerts in frame mode`} onChange={(frameAlert) => setItems((current) => current.map((candidate) => candidate.entityId === item.entityId ? { ...candidate, frameAlert } : candidate))} />
              </div>
              <Button size="sm" onClick={() => setItems((current) => current.filter((candidate) => candidate.entityId !== item.entityId))}>Remove</Button>
            </div>
          ))}
          {items.length === 0 && <div style={{ color: 'var(--ink2)', fontWeight: 650 }}>No devices selected yet.</div>}
        </div>
      </Card>

      <Card padding="20px 22px">
        <div style={{ fontSize: 19, fontWeight: 850 }}>Add to Home</div>
        <div style={{ display: 'flex', gap: 5, marginTop: 12, padding: 5, borderRadius: 16, background: 'var(--chip)', width: 'fit-content' }}>
          {([['devices', 'Devices'], ['actions', 'Scenes & actions'], ['entities', 'Individual entities']] as const).map(([id, label]) => (
            <Button key={id} variant="quiet" selected={pickerMode === id} onClick={() => { setPickerMode(id); setCategory(id === 'devices' ? 'security' : 'all'); }} style={{ minHeight: 40, background: pickerMode === id ? 'var(--card)' : 'transparent', color: pickerMode === id ? 'var(--ink)' : 'var(--ink2)', boxShadow: pickerMode === id ? '0 2px 7px rgba(20,24,40,.12)' : 'none' }}>{label}</Button>
          ))}
        </div>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={pickerMode === 'devices' ? 'Search devices, rooms, or models' : 'Search by name or entity ID'} style={{ width: '100%', boxSizing: 'border-box', margin: '12px 0', minHeight: 50, padding: '0 15px', borderRadius: 15, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', font: 'inherit', fontWeight: 700 }} />
        {pickerMode !== 'actions' && (
          <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 12 }}>
            <Button size="sm" selected={category === 'all'} onClick={() => setCategory('all')}>All</Button>
            {CATEGORIES.map((option) => {
              const count = pickerMode === 'devices'
                ? devices.filter((device) => !selectedDevices.has(device.deviceId) && device.category === option.id).length
                : entities.filter((entity) => !selected.has(entity.entityId) && homeCategoryFor(entity) === option.id).length;
              if (!count) return null;
              return <Button key={option.id} size="sm" selected={category === option.id} onClick={() => setCategory(option.id)} style={{ whiteSpace: 'nowrap' }}><Icon name={option.icon} size={16} /> {option.label} · {count}</Button>;
            })}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(285px, 1fr))', gap: 9 }}>
          {pickerMode === 'devices' && availableDevices.map((device) => {
            const primary = device.entities.find((entity) => entity.entityId === device.primaryEntityId)!;
            const companions = device.entities.filter((entity) => entity.entityId !== device.primaryEntityId && (entity.deviceClass === 'battery' || ['door', 'window', 'opening', 'temperature', 'humidity', 'problem', 'tamper', 'moisture'].includes(entity.deviceClass ?? ''))).length;
            return (
              <TapButton key={device.deviceId} onClick={() => setItems((current) => [...current, { entityId: primary.entityId, deviceId: device.deviceId, displayName: device.name, frameAlert: device.frameAlert, sourceName: device.name, area: device.area, domain: primary.domain, deviceClass: primary.deviceClass }])} style={{ minHeight: 76, padding: '11px 13px', border: '1px solid var(--line)', borderRadius: 16, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 11 }}>
                <span style={{ width: 40, height: 40, borderRadius: 13, display: 'grid', placeItems: 'center', background: soft(categoryInfo(device.category).hue, night), color: deep(categoryInfo(device.category).hue, night) }}><Icon name={iconFor(primary)} size={20} /></span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontWeight: 825 }}>{device.name}</span>
                  <span style={{ display: 'block', marginTop: 2, color: 'var(--ink2)', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{primary.entityId}</span>
                  <span style={{ display: 'block', marginTop: 2, color: 'var(--ink2)', opacity: 0.78, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[device.area, device.model, companions ? `${companions} companion state${companions === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}</span>
                </span>
                <Icon name="plus" size={18} style={{ opacity: 0.55 }} />
              </TapButton>
            );
          })}
          {pickerMode === 'actions' && actions.map((entity) => <EntityChoice key={entity.entityId} entity={entity} onAdd={() => setItems((current) => [...current, editingItem(entity)])} />)}
          {pickerMode === 'entities' && available.map((entity) => <EntityChoice key={entity.entityId} entity={entity} onAdd={() => setItems((current) => [...current, editingItem(entity)])} />)}
        </div>
        {entities.length === 0 && <div style={{ color: 'var(--ink2)', fontWeight: 650 }}>No entities are available. Check the Home Assistant connection in Settings.</div>}
        {pickerMode === 'devices' && devices.length > 0 && availableDevices.length === 0 && <div style={{ color: 'var(--ink2)', fontWeight: 650 }}>No matching devices in this category.</div>}
      </Card>
    </div>
  );
}

function editingItem(entity: HomeCandidate): EditingItem {
  return { entityId: entity.entityId, deviceId: null, displayName: entity.name, frameAlert: entity.frameAlert, sourceName: entity.name, area: entity.area, domain: entity.domain, deviceClass: entity.deviceClass };
}

function EntityChoice({ entity, onAdd }: { entity: HomeCandidate; onAdd: () => void }) {
  return (
    <TapButton onClick={onAdd} style={{ minHeight: 68, padding: '10px 13px', border: '1px solid var(--line)', borderRadius: 15, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 34, height: 34, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'var(--chip)', color: 'var(--ink2)' }}><Icon name={iconFor(entity)} size={18} /></span>
      <span style={{ minWidth: 0, flex: 1 }}><span style={{ display: 'block', fontWeight: 800 }}>{entity.name}</span><span style={{ display: 'block', color: 'var(--ink2)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[entity.area, entity.entityId].filter(Boolean).join(' · ')}</span></span>
      <Icon name="plus" size={18} style={{ opacity: 0.55 }} />
    </TapButton>
  );
}
