/**
 * What version am I, and is there a newer one?
 *
 * `APP_VERSION` is stamped into the image at build time. The release check
 * needs no credentials: the repository is public, so GitHub answers
 * /releases/latest anonymously. A token is still honoured if one happens to be
 * set — it only raises the rate limit, which one call an hour never approaches.
 */

export interface VersionInfo {
  /** The build this server is running, e.g. `v0.2.0` or `v0.2.0-3-gabc1234`. */
  current: string;
  /** Newest release tag seen on GitHub. Null until the first check lands. */
  available: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
  checkedAt: string | null;
  /** Set when the last check failed, so Settings can say why. */
  error: string | null;
}

const REPO = process.env.UPDATE_REPO ?? 'johndelong/hearth';
/** Optional. Only raises the API rate limit; the check works without it. */
const TOKEN = process.env.UPDATE_CHECK_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
const INTERVAL_MS = Number(process.env.UPDATE_CHECK_INTERVAL_MS ?? 60 * 60_000);

export const CURRENT_VERSION = process.env.APP_VERSION ?? 'dev';

let latest: Omit<VersionInfo, 'current'> = {
  available: null,
  releaseUrl: null,
  releaseNotes: null,
  checkedAt: null,
  error: null,
};

export function versionInfo(): VersionInfo {
  return { current: CURRENT_VERSION, ...latest };
}

/** Compares `v1.2.3` style tags. Returns true when `candidate` is newer. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split(/[.-]/)
      .slice(0, 3)
      .map((n) => Number.parseInt(n, 10) || 0);
  const [a1 = 0, a2 = 0, a3 = 0] = parse(candidate);
  const [b1 = 0, b2 = 0, b3 = 0] = parse(current);
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 > b3;
}

async function checkOnce(): Promise<void> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'hearth-dashboard',
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : null),
      },
    });

    if (res.status === 404) {
      // No releases published yet — not an error worth shouting about.
      latest = { ...latest, available: null, checkedAt: new Date().toISOString(), error: null };
      return;
    }
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`);

    const body = (await res.json()) as { tag_name?: string; html_url?: string; body?: string };
    latest = {
      available: body.tag_name ?? null,
      releaseUrl: body.html_url ?? null,
      releaseNotes: body.body?.slice(0, 2000) ?? null,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  } catch (err) {
    latest = {
      ...latest,
      checkedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

let timer: NodeJS.Timeout | null = null;

export function startVersionChecks(): void {
  if (timer) return;
  void checkOnce();
  timer = setInterval(() => void checkOnce(), INTERVAL_MS);
  timer.unref?.();
}

/** Lets Settings force a check instead of waiting for the next interval. */
export async function checkNow(): Promise<VersionInfo> {
  await checkOnce();
  return versionInfo();
}
