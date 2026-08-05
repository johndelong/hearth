import type {
  CalendarEvent,
  Chore,
  Claim,
  Extra,
  GoogleAccount,
  Person,
  PointsBalance,
  Redemption,
  Reward,
  Settings,
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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
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
  chores: Chore[];
  extras: Extra[];
  claims: Claim[];
  rewards: Reward[];
  points: PointsBalance[];
  redemptions: Redemption[];
}

export interface VersionInfo {
  current: string;
  available: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
  checkedAt: string | null;
  error: string | null;
  checkEnabled: boolean;
}

export const api = {
  version: () => call<VersionInfo>('/api/version'),
  checkVersion: () => post<VersionInfo>('/api/version/check'),

  people: () => call<Person[]>('/api/people'),
  createPerson: (body: Record<string, unknown>) => post<Person>('/api/people', body),
  updatePerson: (id: string, body: Record<string, unknown>) => patch<Person>(`/api/people/${id}`, body),
  deletePerson: (id: string) => del<{ ok: true }>(`/api/people/${id}`),

  board: () => call<Board>('/api/chores/board'),
  setChoreDone: (id: string, done: boolean) =>
    post<{ chore: Chore; points: PointsBalance[] }>(`/api/chores/${id}/done`, { done }),
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

  events: (from: Date, to: Date) =>
    call<CalendarEvent[]>(`/api/events?from=${from.toISOString()}&to=${to.toISOString()}`),
  createEvent: (body: Record<string, unknown>) => post<{ googleId: string }>('/api/events', body),
  updateEvent: (id: string, body: Record<string, unknown>) => patch<{ ok: true }>(`/api/events/${id}`, body),
  deleteEvent: (id: string) => del<{ ok: true }>(`/api/events/${id}`),

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
