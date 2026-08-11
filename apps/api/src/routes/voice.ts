import type { FastifyInstance } from 'fastify';
import { requireVoiceParent, voiceBindingIsActive, voiceSessionBinding, voiceSessionExpiresAt } from '../auth.js';

const VOICE_GATEWAY_URL = (process.env.VOICE_GATEWAY_URL ?? '').replace(/\/$/, '');
const VOICE_GATEWAY_TOKEN = process.env.VOICE_GATEWAY_TOKEN ?? '';

export async function revokeVoiceSession(binding: string | null): Promise<void> {
  if (!binding || !VOICE_GATEWAY_URL || !VOICE_GATEWAY_TOKEN) return;
  try {
    await fetch(`${VOICE_GATEWAY_URL}/hearth/revoke`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${VOICE_GATEWAY_TOKEN}`,
        'x-voice-session-binding': binding,
      },
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // The local session is still invalidated; the gateway will expire the socket.
  }
}

export async function voiceRoutes(app: FastifyInstance) {
  app.get('/api/voice/validate', async (request, reply) => {
    const supplied = request.headers.authorization ?? '';
    if (!VOICE_GATEWAY_TOKEN || supplied !== `Bearer ${VOICE_GATEWAY_TOKEN}`) {
      return reply.code(401).send({ valid: false });
    }
    const binding = request.headers['x-voice-session-binding'];
    const value = Array.isArray(binding) ? binding[0] : binding;
    return { valid: voiceBindingIsActive(value ?? '') };
  });

  app.get('/api/voice/config', { preHandler: requireVoiceParent }, async (request, reply) => {
    if (!VOICE_GATEWAY_URL || !VOICE_GATEWAY_TOKEN) {
      return reply.code(404).send({ ok: false, error: 'voice_not_configured' });
    }

    const sessionBinding = voiceSessionBinding(request);
    const sessionExpiresAt = voiceSessionExpiresAt(request);
    if (!sessionBinding || !sessionExpiresAt) return reply.code(401).send({ ok: false, error: 'parent_session_required' });
    try {
      const response = await fetch(`${VOICE_GATEWAY_URL}/hearth/token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${VOICE_GATEWAY_TOKEN}`,
          'x-voice-principal': 'parent_session',
          'x-voice-session-binding': sessionBinding,
          'x-voice-session-expires-at': String(sessionExpiresAt),
        },
        signal: AbortSignal.timeout(5000),
      });
      const body = (await response.json()) as { ok?: boolean; token?: string; expires_in?: number; error?: string };
      if (!response.ok || !body.ok || !body.token) {
        return reply.code(response.status >= 500 ? 503 : 502).send({ ok: false, error: body.error ?? 'voice_gateway_unavailable' });
      }

      const wsUrl = VOICE_GATEWAY_URL.replace(/^http/, 'ws') + '/hearth/media';
      return { ok: true, wsUrl, voiceToken: body.token, expiresIn: body.expires_in ?? 120 };
    } catch {
      return reply.code(503).send({ ok: false, error: 'voice_gateway_unavailable' });
    }
  });
}
