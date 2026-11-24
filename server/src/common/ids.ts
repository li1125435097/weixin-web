import { randomBytes } from 'crypto';

export function newId(prefix?: string): string {
  const body = randomBytes(16).toString('base64url');
  return prefix ? `${prefix}_${body}` : body;
}

export function isRoomId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,80}$/.test(value);
}
