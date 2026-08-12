import type {
  BoardChore,
  CalendarEvent,
  Chore,
  Claim,
  Extra,
  GoogleAccount,
  Person,
  PointEvent,
  Recurrence,
  PointsBalance,
  Redemption,
  Reward,
  Settings,
  Streak,
  SubscribedCalendar,
} from '@dashboard/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
  /** True when the call failed only because Settings is locked. */
  get needsPin(): boolean {
    return this.status === 401;
  }
}

/**
 * The version the server last reported, learned from response headers rather
 * than a dedicated poll. Listeners are notified only when it actually changes.
 */
let serverVersion: string | null = null;
const versionListeners = new Set<(version: string) => void>();

export function onServerVersion(fn: (version: string) => void): () => void {
  versionListeners.add(fn);
  if (serverVersion) fn(serverVersion);
  return () => versionListeners.delete(fn);
}

function noteVersion(res: Response): void {
  const seen = res.headers.get('x-hearth-version');
  if (!seen || seen === serverVersion) return;
  serverVersion = seen;
  for (const fn of versionListeners) fn(seen);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  noteVersion(res);
  if (!res.ok) {
    let body: unknown;
    let message = res.statusText;
    try {
      body = await res.json();
      if (body && typeof body === 'object' && 'error' in body) message = String((body as { error: unknown }).error);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const post = <T,>(path: string, body?: unknown) =>
  call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T,>(path: string, body: unknown) =>
  call<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T,>(path: string) => call<T>(path, { method: 'DELETE' });

export interface Board {
  /** The day this board describes, `YYYY-MM-DD`. */
  date: string;
  today: boolean;
  /** A past board is a record. The week ahead stays writable, so this is false there. */
  readOnly: boolean;
  /** Whole days from today to this board. Negative in the past, 0 for today. */
  daysAhead: number;
  /** One row per person per chore — see BoardChore. */
  chores: BoardChore[];
  extras: Extra[];
  claims: Claim[];
  rewards: Reward[];
  points: PointsBalance[];
  redemptions: Redemption[];
  streaks: Streak[];
}

/**
 * Whether this machine can install an update from here, and how the last
 * attempt went. `available` is false unless a host update agent has registered
 * itself — see scripts/install-updater.sh.
 */
export interface UpdaterInfo {
  available: boolean;
  state: 'idle' | 'requested' | 'running' | 'ok' | 'failed';
  tag: string | null;
  message: string | null;
  updatedAt: string | null;
}

export interface VersionInfo {
  current: string;
  available: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
  checkedAt: string | null;
  error: string | null;
  updater: UpdaterInfo;
}

export interface PointLedger {
  personId: string;
  points: number;
  events: PointEvent[];
}

export const api = {
  version: () => call<VersionInfo>('/api/version'),
  checkVersion: () => post<VersionInfo>('/api/version/check'),
  installUpdate: (tag: string) => post<UpdaterInfo>('/api/version/update', { tag }),

  people: () => call<Person[]>('/api/people'),
  createPerson: (body: Record<string, unknown>) => post<Person>('/api/people', body),
  updatePerson: (id: string, body: Record<string, unknown>) => patch<Person>(`/api/people/${id}`, body),
  deletePerson: (id: string) => del<{ ok: true }>(`/api/people/${id}`),

  board: (date?: string) => call<Board>(`/api/chores/board${date ? `?date=${date}` : ''}`),
  setStreakPaused: (personId: string, paused: boolean) =>
    post<Streak>(`/api/people/${personId}/streak-pause`, { paused }),
  /** `date` names the occurrence being satisfied — omit it to mean today. */
  setChoreDone: (id: string, personId: string, done: boolean, date?: string) =>
    post<{ chore: BoardChore; points: PointsBalance[] }>(`/api/chores/${id}/done`, {
      personId,
      done,
      date,
    }),
  /** Every chore, including ones not due today. Settings manages against this. */
  allChores: () => call<Chore[]>('/api/chores'),
  createChore: (body: Record<string, unknown>) => post<Chore>('/api/chores', body),
  updateChore: (id: string, body: Record<string, unknown>) => patch<Chore>(`/api/chores/${id}`, body),
  deleteChore: (id: string) => del<{ ok: true }>(`/api/chores/${id}`),

  claim: (extraId: string, personId: string) => post<Claim>('/api/claims', { extraId, personId }),
  setClaimDone: (id: string, done: boolean) =>
    post<{ claim: Claim; points: PointsBalance[] }>(`/api/claims/${id}/done`, { done }),
  deleteClaim: (id: string) => del<{ ok: true }>(`/api/claims/${id}`),

  createExtra: (body: Record<string, unknown>) => post<Extra>('/api/extras', body),
  updateExtra: (id: string, body: Record<string, unknown>) => patch<Extra>(`/api/extras/${id}`, body),
  deleteExtra: (id: string) => del<{ ok: true }>(`/api/extras/${id}`),

  createReward: (body: Record<string, unknown>) => post<Reward>('/api/rewards', body),
  updateReward: (id: string, body: Record<string, unknown>) => patch<Reward>(`/api/rewards/${id}`, body),
  deleteReward: (id: string) => del<{ ok: true }>(`/api/rewards/${id}`),

  redeem: (personId: string, rewardId: string) =>
    post<{ redemption: Redemption; points: PointsBalance[] }>('/api/redemptions', { personId, rewardId }),

  /** One person's ledger, newest first, with the balance it adds up to. */
  pointHistory: (personId: string, limit = 100) =>
    call<PointLedger>(`/api/points/${personId}/history?limit=${limit}`),
  adjustPoints: (personId: string, delta: number, reason: string) =>
    post<PointLedger>('/api/points/adjust', { personId, delta, reason }),

  events: (from: Date, to: Date) =>
    call<CalendarEvent[]>(`/api/events?from=${from.toISOString()}&to=${to.toISOString()}`),
  createEvent: (body: Record<string, unknown>) => post<{ googleId: string }>('/api/events', body),
  updateEvent: (id: string, body: Record<string, unknown>) => patch<{ ok: true }>(`/api/events/${id}`, body),
  /** `scope` says whether a repeating event loses one occurrence or all of them. */
  deleteEvent: (id: string, scope: 'this' | 'all' = 'this') =>
    del<{ ok: true }>(`/api/events/${id}?scope=${scope}`),
  /** How a repeating event repeats, read from Google on demand. */
  eventSeries: (id: string) =>
    call<{ recurrence: Recurrence | null; editable: boolean }>(`/api/events/${id}/series`),

  calendars: () =>
    call<{ accounts: GoogleAccount[]; calendars: SubscribedCalendar[]; configured: boolean }>('/api/calendars'),
  updateCalendar: (id: string, body: { personId?: string | null; enabled?: boolean }) =>
    patch<SubscribedCalendar>(`/api/calendars/${id}`, body),
  syncCalendars: () => post<{ calendars: number; changed: number }>('/api/calendars/sync'),
  googleAuthUrl: () => call<{ url: string }>('/api/google/auth-url'),
  disconnectAccount: (id: string) => del<{ ok: true }>(`/api/google/accounts/${id}`),

  settings: () => call<Settings>('/api/settings'),
  updateSettings: (body: Partial<Settings>) => patch<Settings>('/api/settings', body),

  session: () => call<{ unlocked: boolean; pinSet: boolean }>('/api/session'),
  unlock: (pin: string) => post<{ unlocked: boolean }>('/api/session', { pin }),
  lock: () => del<{ unlocked: false }>('/api/session'),
  setPin: (pin: string, currentPin?: string) => post<{ pinSet: boolean }>('/api/settings/pin', { pin, currentPin }),
  clearPin: () => del<{ pinSet: false }>('/api/settings/pin'),
};
