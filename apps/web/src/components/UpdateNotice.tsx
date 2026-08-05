import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { EASE, col } from '../theme';
import { Icon, TapButton } from './ui';

export interface VersionState {
  /** The server is running different code than this tab loaded. Reload fixes it. */
  stale: boolean;
  /** A newer release exists on GitHub but the mini has not been redeployed. */
  releaseAvailable: string | null;
  releaseUrl: string | null;
  current: string;
}

/**
 * Watches the server's version.
 *
 * Two different problems wear the same hat. A wall panel left open for weeks is
 * running whatever JavaScript it loaded back then, so after a deploy it needs a
 * reload — that is `stale`, and it is the one that actually breaks things. A
 * newer release sitting on GitHub is just information for whoever deploys.
 */
export function useVersionWatch(idle: boolean): VersionState {
  const [state, setState] = useState<VersionState>({
    stale: false,
    releaseAvailable: null,
    releaseUrl: null,
    current: 'dev',
  });
  /** The version this tab booted against — the baseline for staleness. */
  const bootVersion = useRef<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const info = await api.version();
      if (bootVersion.current === null) bootVersion.current = info.current;
      setState({
        // `dev` builds change constantly; only compare real releases.
        stale: info.current !== bootVersion.current && info.current !== 'dev',
        releaseAvailable: info.available && info.available !== info.current ? info.available : null,
        releaseUrl: info.releaseUrl,
        current: info.current,
      });
    } catch {
      // A failed check means the server is mid-restart. Staying quiet is right:
      // the next poll picks up the new version and prompts the reload.
    }
  }, []);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => void poll(), 60_000);
    return () => window.clearInterval(timer);
  }, [poll]);

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
        Hearth {version} is ready
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
