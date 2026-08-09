import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useOnWake } from '../../state';

/**
 * Google's sync is invisible from the couch: a calendar that stopped syncing
 * days ago looks exactly like a quiet week. This turns that silence into a
 * sentence the calendar can show.
 *
 * The server writes `lastSyncAt` on every pass whether or not it succeeded, so
 * a timestamp that has stopped moving means the sync loop itself is stuck —
 * a different failure from an account Google is refusing, and one no per-account
 * error would ever report.
 */

/** Server polls Google every 5 minutes; six missed passes is not a blip. */
const STALE_AFTER_MS = 30 * 60_000;

export function useSyncHealth(): string | null {
  const [warning, setWarning] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const { accounts } = await api.calendars();

      // No accounts is not a failure — there is simply nothing to sync, and the
      // empty calendar already says so.
      if (accounts.length === 0) return setWarning(null);

      const broken = accounts.find((a) => a.error);
      if (broken) {
        return setWarning(`${broken.email} isn't syncing. Open Settings to reconnect it.`);
      }

      const newest = accounts.reduce((latest, a) => {
        const at = a.lastSyncAt ? Date.parse(a.lastSyncAt) : 0;
        return Number.isNaN(at) ? latest : Math.max(latest, at);
      }, 0);
      if (newest && Date.now() - newest > STALE_AFTER_MS) {
        return setWarning('Calendars have not synced recently, so this may be out of date.');
      }

      setWarning(null);
    } catch {
      // The dashboard service being unreachable is the events request's story to
      // tell; saying it twice would only crowd the screen.
      setWarning(null);
    }
  }, []);

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => void check(), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [check]);

  useOnWake(() => void check());

  return warning;
}
