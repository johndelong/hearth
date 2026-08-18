import type { FastifyInstance } from 'fastify';
import { requireParent } from '../auth.js';
import { protect, unprotect } from '../crypto.js';
import { getSettings, getRaw, setRaw, deleteRaw, updateSettings } from '../store/settings.js';
import { recordActivity } from '../store/activity.js';

interface Album {
  id: string;
  name: string;
  assetCount: number;
}

interface Asset {
  id: string;
  type: string;
  isVisible: boolean;
}

interface ImmichConfig {
  url: string;
  apiKey: string;
}

const URL_KEY = '_immichUrl';
const KEY_KEY = '_immichApiKey';
const idPattern = /^[a-zA-Z0-9-]{1,128}$/;
const ASSET_CACHE_MS = 2 * 60_000;
const MAX_SLIDESHOW_PHOTOS = 200;
let assetCache: { source: string; albumId: string; expiresAt: number; assets: Asset[] } | null = null;

function config(): ImmichConfig | null {
  const url = getRaw(URL_KEY);
  const apiKey = unprotect(getRaw(KEY_KEY));
  return url && apiKey ? { url, apiKey } : null;
}

function cleanUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function endpoint(cfg: ImmichConfig, path: string): string {
  return `${cfg.url}/api/${path}`;
}

async function immich(cfg: ImmichConfig, path: string): Promise<Response> {
  try {
    return await fetch(endpoint(cfg, path), {
      headers: { 'x-api-key': cfg.apiKey, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error('Could not reach Immich');
  }
}

async function albums(cfg: ImmichConfig): Promise<Album[]> {
  const response = await immich(cfg, 'albums');
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Immich rejected that API key' : 'Could not load Immich albums');
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error('Immich returned an unexpected album list');
  return body.flatMap((item): Album[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : '';
    const name = typeof row.albumName === 'string' ? row.albumName : typeof row.name === 'string' ? row.name : '';
    const assetCount = typeof row.assetCount === 'number' ? row.assetCount : 0;
    return id && name ? [{ id, name, assetCount }] : [];
  });
}

async function selectedAssets(cfg: ImmichConfig): Promise<Asset[]> {
  const albumId = getSettings().photoAlbumId;
  if (!albumId || !idPattern.test(albumId)) return [];
  const source = `${cfg.url}:${albumId}`;
  if (assetCache?.source === source && assetCache.expiresAt > Date.now()) return assetCache.assets;
  const response = await immich(cfg, `albums/${encodeURIComponent(albumId)}`);
  if (!response.ok) throw new Error('Could not load the selected Immich album');
  const body: unknown = await response.json();
  const list: unknown[] = body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).assets)
    ? (body as Record<string, unknown>).assets as unknown[]
    : [];
  const assets = list.flatMap((item): Asset[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : '';
    const type = typeof row.type === 'string' ? row.type : '';
    return id && idPattern.test(id) && type === 'IMAGE' && row.isVisible !== false ? [{ id, type, isVisible: true }] : [];
  });
  assetCache = { source, albumId, expiresAt: Date.now() + ASSET_CACHE_MS, assets };
  return assets;
}

/** Follows Immich's cache redirect without ever sending its key to another host. */
async function thumbnail(cfg: ImmichConfig, assetId: string): Promise<Response> {
  const origin = new URL(cfg.url).origin;
  let url = endpoint(cfg, `assets/${encodeURIComponent(assetId)}/thumbnail?size=preview`);
  const signal = AbortSignal.timeout(20_000);
  for (let redirects = 0; redirects < 4; redirects += 1) {
    const response = await fetch(url, { headers: { 'x-api-key': cfg.apiKey }, redirect: 'manual', signal });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error('Immich returned a redirect without a location');
    const target = new URL(location, url);
    if (target.origin !== origin) throw new Error('Immich attempted to redirect a photo outside its configured server');
    url = target.toString();
  }
  throw new Error('Immich redirected the photo too many times');
}

export async function photoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/photos/immich', { preHandler: requireParent }, async () => {
    const cfg = config();
    return { configured: Boolean(cfg), url: cfg?.url ?? null };
  });

  app.put<{ Body: { url?: string; apiKey?: string } }>('/api/photos/immich', { preHandler: requireParent }, async (request, reply) => {
    const url = cleanUrl(request.body?.url ?? '');
    const apiKey = request.body?.apiKey?.trim();
    if (!url || !apiKey || apiKey.length > 512) return reply.code(400).send({ error: 'Enter a valid Immich URL and API key' });
    const next = { url, apiKey };
    const available = await albums(next);
    setRaw(URL_KEY, url);
    setRaw(KEY_KEY, protect(apiKey)!);
    assetCache = null;
    const current = getSettings();
    if (current.photoProvider === 'immich' && current.photoAlbumId && !available.some((album) => album.id === current.photoAlbumId)) {
      updateSettings({ photoProvider: 'none', photoAlbumId: null });
    }
    recordActivity('photos.immich.connected');
    return { configured: true, url };
  });

  app.delete('/api/photos/immich', { preHandler: requireParent }, async () => {
    deleteRaw(URL_KEY);
    deleteRaw(KEY_KEY);
    assetCache = null;
    updateSettings({ photoProvider: 'none', photoAlbumId: null });
    recordActivity('photos.immich.disconnected');
    return { ok: true };
  });

  app.get('/api/photos/immich/albums', { preHandler: requireParent }, async (_request, reply) => {
    const cfg = config();
    if (!cfg) return reply.code(400).send({ error: 'Connect Immich first' });
    return albums(cfg);
  });

  // Frame mode is deliberately PIN-free, but it only ever exposes images from
  // the parent-selected album and never sends the Immich key to the browser.
  app.get('/api/photos/immich/assets', async (request, reply) => {
    const cfg = config();
    const settings = getSettings();
    if (!cfg || settings.photoProvider !== 'immich' || !settings.photoAlbumId) return { photos: [] };
    try {
      const photos = (await selectedAssets(cfg)).slice(0, MAX_SLIDESHOW_PHOTOS);
      return { photos: photos.map(({ id }) => ({ id, url: `/api/photos/immich/assets/${encodeURIComponent(id)}` })) };
    } catch (err) {
      request.log.warn(err, 'Could not load Immich slideshow');
      return reply.code(502).send({ error: 'Could not load Immich photos' });
    }
  });

  app.get<{ Params: { id: string } }>('/api/photos/immich/assets/:id', async (request, reply) => {
    const cfg = config();
    const settings = getSettings();
    const assetId = request.params.id;
    if (!cfg || settings.photoProvider !== 'immich' || !idPattern.test(assetId)) return reply.code(404).send({ error: 'Photo not found' });
    try {
      // Check membership here as well: a URL is not an authorization grant to
      // arbitrary pictures in a household's Immich library.
      if (!(await selectedAssets(cfg)).some((asset) => asset.id === assetId)) return reply.code(404).send({ error: 'Photo not found' });
      const response = await thumbnail(cfg, assetId);
      if (!response.ok || !response.body) return reply.code(502).send({ error: 'Could not load photo' });
      return reply
        .header('content-type', response.headers.get('content-type') ?? 'image/jpeg')
        .header('cache-control', 'private, max-age=300')
        .send(response.body);
    } catch (err) {
      request.log.warn(err, 'Could not proxy Immich photo');
      return reply.code(502).send({ error: 'Could not load photo' });
    }
  });

  app.get('/api/photos/immich/health', { preHandler: requireParent }, async (_request, reply) => {
    const cfg = config();
    if (!cfg) return { state: 'disconnected' as const };
    try {
      const asset = (await selectedAssets(cfg))[0];
      if (!asset) return { state: 'no-album' as const };
      const response = await thumbnail(cfg, asset.id);
      if (response.status === 401 || response.status === 403) return { state: 'needs-asset-view' as const };
      if (!response.ok) return { state: 'error' as const };
      return { state: 'ready' as const };
    } catch {
      return reply.code(502).send({ state: 'error' });
    }
  });
}
