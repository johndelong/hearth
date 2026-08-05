import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { accountCredentials, markAccountSynced, saveAccessToken } from '../store/calendars.js';

/**
 * Read+write so the dashboard's "+ Add" button can create real events.
 * calendar.readonly would be enough for display alone.
 */
export const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
];

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const base = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8080}`;
  return { clientId, clientSecret, redirectUri: `${base.replace(/\/$/, '')}/api/google/callback` };
}

export function oauthClient(): OAuth2Client {
  const cfg = googleConfig();
  if (!cfg) throw new Error('Google OAuth is not configured (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)');
  return new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
}

/**
 * An authorized client for a stored account. Refreshed tokens are written back
 * so a restart does not force a new round trip to Google.
 */
export function clientForAccount(accountId: string): OAuth2Client {
  const account = accountCredentials(accountId);
  if (!account) throw new Error(`Unknown Google account ${accountId}`);

  const client = oauthClient();
  client.setCredentials({
    refresh_token: account.refreshToken,
    access_token: account.accessToken ?? undefined,
    expiry_date: account.expiry ?? undefined,
  });

  client.on('tokens', (tokens) => {
    saveAccessToken(
      accountId,
      tokens.access_token ?? account.accessToken,
      tokens.expiry_date ?? account.expiry,
    );
  });

  return client;
}

export function calendarApi(accountId: string) {
  return google.calendar({ version: 'v3', auth: clientForAccount(accountId) });
}

export function markAccountError(accountId: string, message: string | null): void {
  markAccountSynced(accountId, message);
}
