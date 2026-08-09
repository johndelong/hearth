import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
const key = createHash('sha256')
  .update(process.env.CREDENTIAL_ENCRYPTION_KEY ?? process.env.COOKIE_SECRET ?? 'hearth-dev-secret')
  .digest();

export function protect(value: string | null): string | null {
  if (value === null || value.startsWith(PREFIX)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function unprotect(value: string | null): string | null {
  if (value === null || !value.startsWith(PREFIX)) return value;
  const [ivText, tagText, encryptedText] = value.slice(PREFIX.length).split(':');
  if (!ivText || !tagText || !encryptedText) throw new Error('Stored credential is malformed');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8');
}
