import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { requireParent } from './auth.js';
import './db/index.js';
import { seedIfEmpty } from './db/seed.js';
import { startSyncLoop } from './google/sync.js';
import { calendarRoutes } from './routes/calendar.js';
import { choreRoutes } from './routes/chores.js';
import { peopleRoutes } from './routes/people.js';
import { settingsRoutes } from './routes/settings.js';
import { requestUpdate, updaterInfo } from './updater.js';
import { CURRENT_VERSION, checkNow, startVersionChecks, versionInfo } from './version.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // Tablets sit behind the same LAN; trust the proxy only if one is configured.
  trustProxy: process.env.TRUST_PROXY === 'true',
});

await app.register(cookie, { secret: process.env.COOKIE_SECRET ?? 'hearth-dev-secret' });

seedIfEmpty();

/**
 * Every API response carries the running version. The dashboard reads it off
 * calls it already makes, so noticing a deploy costs no extra requests.
 */
app.addHook('onSend', async (_request, reply) => {
  reply.header('x-hearth-version', CURRENT_VERSION);
});

await app.register(peopleRoutes);
await app.register(choreRoutes);
await app.register(settingsRoutes);
await app.register(calendarRoutes);

app.get('/api/health', async () => ({ ok: true, version: CURRENT_VERSION, time: new Date().toISOString() }));

/**
 * The dashboard polls this. A change in `current` means this tab is running
 * older code than the server and should reload; `available` means a newer
 * release exists that this machine has not installed yet. `updater` says
 * whether this machine can install it from the dashboard, and how the last
 * attempt went.
 */
app.get('/api/version', async () => ({ ...versionInfo(), updater: updaterInfo() }));

app.post('/api/version/check', {
  preHandler: requireParent,
  handler: async () => ({ ...(await checkNow()), updater: updaterInfo() }),
});

/**
 * Hand the update off to the launchd agent on the host. Everything past this
 * point happens outside the container — including replacing this process — so
 * the reply is only ever "the request was accepted".
 */
app.post<{ Body: { tag?: string } }>('/api/version/update', {
  preHandler: requireParent,
  handler: async (request, reply) => {
    const info = versionInfo();
    const tag = request.body?.tag ?? info.available;
    if (!tag) return reply.code(400).send({ error: 'No release available to install' });
    // The tag is handed to a shell script; keep it to what a git tag can be.
    if (!/^[\w][\w.+-]{0,63}$/.test(tag)) return reply.code(400).send({ error: 'Invalid release tag' });

    try {
      return requestUpdate(tag);
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : 'Update failed' });
    }
  },
});

// In production the API also serves the built web client from the same origin,
// which keeps the container to a single process and avoids CORS entirely.
const webRoot = join(here, '..', '..', 'web', 'dist');
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, { root: webRoot });
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html'); // client-side routing fallback
  });
}

startSyncLoop();
startVersionChecks();

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
