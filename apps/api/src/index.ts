import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import './db/index.js';
import { seedIfEmpty } from './db/seed.js';
import { startSyncLoop } from './google/sync.js';
import { calendarRoutes } from './routes/calendar.js';
import { choreRoutes } from './routes/chores.js';
import { peopleRoutes } from './routes/people.js';
import { settingsRoutes } from './routes/settings.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // Tablets sit behind the same LAN; trust the proxy only if one is configured.
  trustProxy: process.env.TRUST_PROXY === 'true',
});

await app.register(cookie, { secret: process.env.COOKIE_SECRET ?? 'family-dashboard-dev-secret' });

seedIfEmpty();

await app.register(peopleRoutes);
await app.register(choreRoutes);
await app.register(settingsRoutes);
await app.register(calendarRoutes);

app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

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

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
