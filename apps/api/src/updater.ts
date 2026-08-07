/**
 * Asking the host to update us.
 *
 * A container cannot rebuild itself: the process doing the work is killed
 * partway through when its own container is replaced. So the work happens
 * outside Docker, in a launchd agent watching a directory that is bind-mounted
 * into this container. We drop a request in it; the agent picks it up, runs
 * `scripts/update.sh`, and writes back what happened.
 *
 * Nothing here shells out or talks to Docker — the whole interface is four
 * files in one directory:
 *
 *   agent.json    written by scripts/install-updater.sh. Its presence is what
 *                 tells the dashboard an updater exists at all.
 *   request.json  written here when someone taps Update.
 *   status.json   written by the update script as it goes.
 *   update.log    the script's full output, for when status.json says "failed".
 *
 * With no directory mounted (development, or a host that never installed the
 * agent) every read below simply reports "not available" and the dashboard
 * falls back to showing the release link.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CONTROL_DIR = process.env.UPDATE_CONTROL_DIR ?? '/control';

/** How the last update attempt is going, as far as anyone here can tell. */
export type UpdateState = 'idle' | 'requested' | 'running' | 'ok' | 'failed';

export interface UpdaterInfo {
  /** True when the launchd agent has registered itself. Gates the button. */
  available: boolean;
  state: UpdateState;
  /** The release the current (or last) attempt is moving to. */
  tag: string | null;
  /** Human-readable detail, shown as-is under the version. */
  message: string | null;
  updatedAt: string | null;
}

const IDLE: UpdaterInfo = {
  available: false,
  state: 'idle',
  tag: null,
  message: null,
  updatedAt: null,
};

function readJson(name: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(CONTROL_DIR, name), 'utf8')) as Record<string, unknown>;
  } catch {
    // Missing, unreadable, or half-written — all mean "nothing to report".
    return null;
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function updaterInfo(): UpdaterInfo {
  if (!readJson('agent.json')) return IDLE;

  const status = readJson('status.json');
  if (!status) return { ...IDLE, available: true };

  const state = status.state;
  return {
    available: true,
    state:
      state === 'requested' || state === 'running' || state === 'ok' || state === 'failed'
        ? state
        : 'idle',
    tag: str(status.tag),
    message: str(status.message),
    updatedAt: str(status.updatedAt),
  };
}

/**
 * Ask the agent to move to `tag`.
 *
 * The status is written here rather than waiting for the script, so the
 * dashboard shows "Starting the update" the moment the button is tapped —
 * launchd can take a second or two to notice the new file.
 */
export function requestUpdate(tag: string): UpdaterInfo {
  if (!readJson('agent.json')) {
    throw new Error('No update agent is installed on this machine');
  }

  const now = new Date().toISOString();
  writeFileSync(
    join(CONTROL_DIR, 'status.json'),
    `${JSON.stringify({ state: 'requested', tag, message: 'Starting the update', updatedAt: now }, null, 2)}\n`,
  );
  // Written last: this is the file launchd watches, so everything else must
  // already be in place when it lands.
  writeFileSync(
    join(CONTROL_DIR, 'request.json'),
    `${JSON.stringify({ tag, requestedAt: now }, null, 2)}\n`,
  );

  return updaterInfo();
}
