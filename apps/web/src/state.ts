import { DEFAULT_SETTINGS, type Person, type Settings } from '@dashboard/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Board, api } from './api';

export type Tab = 'today' | 'chores' | 'settings';

export interface Toast {
  text: string;
  hue: number;
}

/** Night mode follows the setting, or the clock when set to Auto. */
export function useNight(theme: Settings['theme']): boolean {
  const [night, setNight] = useState(() => computeNight(theme));
  useEffect(() => {
    setNight(computeNight(theme));
    if (theme !== 'Auto') return;
    const timer = window.setInterval(() => setNight(computeNight('Auto')), 60_000);
    return () => window.clearInterval(timer);
  }, [theme]);
  return night;
}

function computeNight(theme: Settings['theme']): boolean {
  if (theme === 'Night') return true;
  if (theme === 'Day') return false;
  const h = new Date().getHours();
  return h >= 20 || h < 6;
}

/**
 * Frame mode. After `idleMin` with no touch the dashboard steps back to a clock,
 * which is what a wall panel should show most of the day.
 */
export function useIdle(idleMin: number): [boolean, () => void, () => void] {
  const [idle, setIdle] = useState(false);
  const last = useRef(Date.now());

  const poke = useCallback(() => {
    last.current = Date.now();
    setIdle((was) => (was ? false : was));
  }, []);

  const sleep = useCallback(() => setIdle(true), []);

  useEffect(() => {
    if (!idleMin) return;
    const timer = window.setInterval(() => {
      if (Date.now() - last.current > idleMin * 60_000) setIdle(true);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [idleMin]);

  return [idle, poke, sleep];
}

/**
 * Runs `fn` when the panel comes back to life.
 *
 * A tablet left on the wall sleeps its tab, and a sleeping tab's timers sleep
 * with it — so a poll that should have run at 3am runs whenever the screen wakes
 * instead, and until it does the panel is showing yesterday. Waking is spelled
 * three different ways depending on how the tab was put away: `visibilitychange`
 * for a backgrounded tab, `pageshow` for one restored from the back/forward
 * cache, and `online` for a panel whose wifi dropped and returned.
 */
export function useOnWake(fn: () => void): void {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  }, [fn]);

  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'visible') latest.current();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pageshow', wake);
    window.addEventListener('online', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('pageshow', wake);
      window.removeEventListener('online', wake);
    };
  }, []);
}

/** Ticks once a minute so clocks and the "now" line stay honest. */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const align = 60_000 - (Date.now() % 60_000);
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      setNow(new Date());
      interval = window.setInterval(() => setNow(new Date()), 60_000);
    }, align);
    return () => {
      window.clearTimeout(timeout);
      if (interval) window.clearInterval(interval);
    };
  }, []);
  return now;
}

export function useToast(): [Toast | null, (text: string, hue?: number) => void] {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | null>(null);

  const say = useCallback((text: string, hue = 258) => {
    if (timer.current) window.clearTimeout(timer.current);
    setToast({ text, hue });
    timer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  return [toast, say];
}

export interface AppData {
  people: Person[];
  settings: Settings;
  board: Board | null;
  loading: boolean;
  error: string | null;
  reloadPeople: () => Promise<void>;
  reloadBoard: () => Promise<void>;
  /** `YYYY-MM-DD` the Chores screen is looking at, or null for today. */
  boardDate: string | null;
  setBoardDate: (date: string | null) => void;
  reloadSettings: () => Promise<void>;
  setSettings: (s: Settings) => void;
  setBoard: (b: Board) => void;
}

const EMPTY_BOARD: Board = {
  date: '',
  today: true,
  readOnly: false,
  daysAhead: 0,
  chores: [],
  extras: [],
  claims: [],
  rewards: [],
  points: [],
  redemptions: [],
  streaks: [],
};

export function useAppData(): AppData {
  const [people, setPeople] = useState<Person[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [board, setBoard] = useState<Board | null>(null);
  const [boardDate, setBoardDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadPeople = useCallback(async () => {
    setPeople(await api.people());
  }, []);
  const reloadBoard = useCallback(async () => {
    setBoard(await api.board(boardDate ?? undefined));
  }, [boardDate]);
  const reloadSettings = useCallback(async () => {
    setSettings(await api.settings());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, s, b] = await Promise.all([api.people(), api.settings(), api.board()]);
        if (cancelled) return;
        setPeople(p);
        setSettings(s);
        setBoard(b);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not reach the dashboard service');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The panel runs for weeks at a time; poll so a change made on one tablet
  // shows up on the others without anyone reloading.
  useEffect(() => {
    const timer = window.setInterval(() => {
      void api.board(boardDate ?? undefined).then(setBoard).catch(() => undefined);
      void api.people().then(setPeople).catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [boardDate]);

  // A slept tab's poll never ran, so waking is its own reason to refetch.
  useOnWake(() => {
    void api.board(boardDate ?? undefined).then(setBoard).catch(() => undefined);
    void api.people().then(setPeople).catch(() => undefined);
  });

  // Stepping to another day refetches immediately rather than waiting on the poll.
  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    void api.board(boardDate ?? undefined).then(setBoard).catch(() => undefined);
  }, [boardDate]);

  return useMemo(
    () => ({
      people,
      settings,
      board: board ?? (loading ? null : EMPTY_BOARD),
      loading,
      error,
      reloadPeople,
      reloadBoard,
      reloadSettings,
      setSettings,
      setBoard,
      boardDate,
      setBoardDate,
    }),
    [people, settings, board, loading, error, reloadPeople, reloadBoard, reloadSettings, boardDate],
  );
}
