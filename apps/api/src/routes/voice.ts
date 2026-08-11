import type { FastifyInstance } from 'fastify';
import { requireParent } from '../auth.js';

const VOICE_GATEWAY_URL = (process.env.VOICE_GATEWAY_URL ?? '').replace(/\/$/, '');
const VOICE_GATEWAY_TOKEN = process.env.VOICE_GATEWAY_TOKEN ?? '';

export async function voiceRoutes(app: FastifyInstance) {
  app.get('/api/voice/config', { preHandler: requireParent }, async (_request, reply) => {
    if (!VOICE_GATEWAY_URL || !VOICE_GATEWAY_TOKEN) {
      return reply.code(404).send({ ok: false, error: 'voice_not_configured' });
    }

    try {
      const response = await fetch(`${VOICE_GATEWAY_URL}/hearth/token`, {
        method: 'POST',
        headers: { authorization: `Bearer ${VOICE_GATEWAY_TOKEN}`, 'x-voice-principal': 'parent_session' },
        signal: AbortSignal.timeout(5000),
      });
      const body = (await response.json()) as { ok?: boolean; token?: string; expires_in?: number; error?: string };
      if (!response.ok || !body.ok || !body.token) {
        return reply.code(response.status >= 500 ? 503 : 502).send({ ok: false, error: body.error ?? 'voice_gateway_unavailable' });
      }

      const wsUrl = VOICE_GATEWAY_URL.replace(/^http/, 'ws') + `/hearth/media?token=${encodeURIComponent(body.token)}`;
      return { ok: true, wsUrl, expiresIn: body.expires_in ?? 120 };
    } catch {
      return reply.code(503).send({ ok: false, error: 'voice_gateway_unavailable' });
    }
  });
}
