import { displayNameOf } from '../common/admin';

export type UserKind = 'formal' | 'temp';

export interface StoredUser {
  id: string;
  username: string | null;
  passwordHash: string | null;
  nickname: string;
  kind: UserKind;
  expiresAt: number | null;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  username: string;
  nickname: string;
  createdAt: string;
  kind: UserKind;
  displayName: string;
}

export function toPublic(user: StoredUser): PublicUser {
  return {
    id: user.id,
    username: user.username || '',
    nickname: user.nickname,
    createdAt: user.createdAt,
    kind: user.kind,
    displayName: user.kind === 'temp' ? '临时用户' : displayNameOf(user),
  };
}
