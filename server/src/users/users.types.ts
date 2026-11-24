export interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  nickname: string;
  createdAt: string;
}

export interface UserDatabase {
  users: StoredUser[];
}

export interface PublicUser {
  id: string;
  username: string;
  nickname: string;
  createdAt: string;
}

export function toPublic(user: StoredUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    createdAt: user.createdAt,
  };
}
