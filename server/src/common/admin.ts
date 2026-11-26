export const ADMIN_USERNAME = 'lijinke';
export const TEXT_QUOTA = 30_000;
export const VOICE_QUOTA = 20;
export const IMAGE_QUOTA = 30;
export const FILE_QUOTA = 30;
export const TEMP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const TOUCH_GAP_MS = 60 * 60 * 1000;

export function isAdminUsername(username: string | null | undefined): boolean {
  return (username || '').toLowerCase() === ADMIN_USERNAME;
}

export function displayNameOf(user: { username?: string | null; nickname?: string | null }): string {
  if (isAdminUsername(user.username)) return '管理员';
  const nickname = (user.nickname || '').trim();
  if (nickname) return nickname;
  if (user.username) return user.username;
  return '临时用户';
}

export function textUnits(value: string): number {
  return Array.from(value).length;
}
