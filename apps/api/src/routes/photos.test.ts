import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { clearPin } from '../auth.js';
import { deleteRaw, getRaw, updateSettings } from '../store/settings.js';
import { photoRoutes } from './photos.js';

const app = Fastify();
await app.register(cookie, { secret: 'test-secret' });
await app.register(photoRoutes);
await app.ready();

const nativeFetch = globalThis.fetch;

beforeEach(() => {
  clearPin();
  deleteRaw('_immichUrl');
  deleteRaw('_immichApiKey');
  updateSettings({ photoProvider: 'none', photoAlbumId: null });
});

afterEach(() => {
  globalThis.fetch = nativeFetch;
});

test('Immich credentials stay server-side and frame mode lists only selected still photos', async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/api/albums')) {
      return Response.json([{ id: 'album-1', albumName: 'Hallway', assetCount: 3 }]);
    }
    if (url.endsWith('/api/albums/album-1')) {
      return Response.json({
        assets: [
          { id: 'image-1', type: 'IMAGE', isVisible: true },
          { id: 'video-1', type: 'VIDEO', isVisible: true },
          { id: 'hidden-1', type: 'IMAGE', isVisible: false },
        ],
      });
    }
    if (url.includes('/thumbnail?size=preview')) {
      return new Response(null, { status: 302, headers: { location: '/api/cache/image-1' } });
    }
    if (url.endsWith('/api/cache/image-1')) {
      return new Response('image-bytes', { headers: { 'content-type': 'image/jpeg' } });
    }
    throw new Error(`Unexpected Immich request: ${url}`);
  };

  const connect = await app.inject({
    method: 'PUT',
    url: '/api/photos/immich',
    payload: { url: 'http://immich.local:2283/', apiKey: 'not-in-the-browser' },
  });
  assert.equal(connect.statusCode, 200, connect.body);
  assert.equal(getRaw('_immichApiKey')?.startsWith('enc:v1:'), true);
  assert.doesNotMatch(getRaw('_immichApiKey') ?? '', /not-in-the-browser/);

  updateSettings({ photoProvider: 'immich', photoAlbumId: 'album-1' });
  const listed = await app.inject({ method: 'GET', url: '/api/photos/immich/assets' });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json(), { photos: [{ id: 'image-1', url: '/api/photos/immich/assets/image-1' }] });

  const image = await app.inject({ method: 'GET', url: '/api/photos/immich/assets/image-1' });
  assert.equal(image.statusCode, 200);
  assert.equal(image.headers['content-type'], 'image/jpeg');
  assert.equal(image.body, 'image-bytes');
});
