import { useEffect, useRef, useState } from 'react';
import { onServerVersion } from '../api';
import { EASE, col } from '../theme';
import { Icon, TapButton } from './ui';

/**
 * Versions are normally tags like `v0.2.0`, but a rollback or a hand-built image
 * can leave a commit SHA. Nobody needs forty characters of it.
 */
export function displayVersion(version: string): string {
  return /^[0-9a-f]{40}$/i.test(version) ? version.slice(0, 7) : version;
}

export interface VersionState {
  /** The server is running different code than this tab loaded. Reload fixes it. */
  stale: boolean;
  current: string;
}

/**
 * Watches the server's version.
 *
 * A wall panel left open for weeks is running whatever JavaScript it loaded back
 * then, so after a deploy it needs a reload. Rather than polling for that, the
 * version rides along as a header on every API response — the app is already
 * fetching the board once a minute, so this costs nothing extra and reacts as
 * fast as the next request, including immediately on any tap.
 */
export function useVersionWatch(idle: boolean): VersionState {
  const [state, setState] = useState<VersionState>({ stale: false, current: 'dev' });
  /** The version this tab booted against — the baseline for staleness. */
  const bootVersion = useRef<string | null>(null);

  useEffect(() => {
    return onServerVersion((version) => {
      if (bootVersion.current === null) bootVersion.current = version;
      setState((prev) => ({
        ...prev,
        current: version,
        // `dev` rebuilds constantly in development; only flag real releases.
        stale: version !== bootVersion.current && version !== 'dev',
      }));
    });
  }, []);

  /**
   * A panel nobody is touching can just reload itself. This is the whole reason
   * the wall screens never need attention after a deploy.
   */
  useEffect(() => {
    if (state.stale && idle) {
      const timer = window.setTimeout(() => window.location.reload(), 2_000);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [state.stale, idle]);

  return state;
}

/** The refresh prompt, for panels someone is actually using. */
export function UpdateToast({ version, onReload }: { version: string; onReload: () => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 38,
        transform: 'translateX(-50%)',
        zIndex: 130,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '14px 16px 14px 22px',
        borderRadius: 999,
        background: 'var(--card)',
        color: 'var(--ink)',
        boxShadow: '0 8px 30px -10px rgba(20,24,40,.45)',
        borderLeft: `4px solid ${col(258, false)}`,
        animation: `dropIn .4s ${EASE} both`,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 16.5, fontWeight: 800 }}>
        <Icon name="sync" size={19} />
        Hearth {displayVersion(version)} is ready
      </span>
      <TapButton
        onClick={onReload}
        style={{
          minHeight: 44,
          padding: '10px 22px',
          borderRadius: 999,
          background: 'var(--ink)',
          color: 'var(--card)',
          fontSize: 15.5,
          fontWeight: 800,
        }}
      >
        Refresh
      </TapButton>
    </div>
  );
}
