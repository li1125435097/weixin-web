import { ConflictException, Injectable } from '@nestjs/common';
import { TEMP_TTL_MS, TOUCH_GAP_MS } from '../common/admin';
import { newId } from '../common/ids';
import { DatabaseService } from '../db/database.service';
import { PublicUser, StoredUser, toPublic, UserKind } from './users.types';

interface UserRow {
  id: string;
  username: string | null;
  password_hash: string | null;
  nickname: string;
  kind: string;
  expires_at: number | null;
  touched_at: number;
  created_at: number;
}

@Injectable()
export class UsersService {
  constructor(private readonly database: DatabaseService) {}

  findByUsername(username: string): StoredUser | null {
    const row = this.database.get('SELECT * FROM users WHERE username = ?', username);
    return row ? this.map(row as unknown as UserRow) : null;
  }

  findStored(id: string): StoredUser | null {
    const row = this.database.get('SELECT * FROM users WHERE id = ?', id);
    return row ? this.map(row as unknown as UserRow) : null;
  }

  findById(id: string): PublicUser | null {
    const user = this.findStored(id);
    return user ? toPublic(user) : null;
  }

  listIds(): string[] {
    return this.database.all('SELECT id FROM users').map((row) => String(row.id));
  }

  expiredTempIds(now = Date.now()): string[] {
    return this.database
      .all(`SELECT id FROM users WHERE kind = 'temp' AND expires_at IS NOT NULL AND expires_at <= ?`, now)
      .map((row) => String(row.id));
  }

  create(input: { username: string; passwordHash: string; nickname: string }): PublicUser {
    return toPublic(this.insert({ ...input, kind: 'formal', nickname: input.nickname }));
  }

  createTemp(nickname: string): StoredUser {
    return this.insert({ username: null, passwordHash: null, nickname, kind: 'temp' });
  }

  promote(id: string, input: { username: string; passwordHash: string; nickname: string }): StoredUser {
    const current = this.findStored(id);
    if (!current) throw new ConflictException('临时用户不存在');
    const taken = this.findByUsername(input.username);
    if (taken && taken.id !== id) throw new ConflictException('用户名已存在');
    this.database.run(
      `UPDATE users SET username = ?, password_hash = ?, nickname = ?, kind = 'formal', expires_at = NULL WHERE id = ?`,
      input.username,
      input.passwordHash,
      input.nickname,
      id,
    );
    return this.findStored(id) || current;
  }

  setNickname(id: string, nickname: string): void {
    this.database.run('UPDATE users SET nickname = ? WHERE id = ?', nickname, id);
  }

  touch(user: StoredUser): void {
    if (user.kind !== 'temp') return;
    const now = Date.now();
    const row = this.database.get('SELECT touched_at FROM users WHERE id = ?', user.id);
    const touched = row ? Number(row.touched_at) : 0;
    if (now - touched < TOUCH_GAP_MS) return;
    this.database.run('UPDATE users SET expires_at = ?, touched_at = ? WHERE id = ? AND kind = ?', now + TEMP_TTL_MS, now, user.id, 'temp');
  }

  delete(id: string): void {
    this.database.run('DELETE FROM users WHERE id = ?', id);
  }

  private insert(input: { username: string | null; passwordHash: string | null; nickname: string; kind: UserKind }): StoredUser {
    if (input.username) {
      const taken = this.findByUsername(input.username);
      if (taken) throw new ConflictException('用户名已存在');
    }
    const now = Date.now();
    const user: StoredUser = {
      id: newId('u'),
      username: input.username,
      passwordHash: input.passwordHash,
      nickname: input.nickname,
      kind: input.kind,
      expiresAt: input.kind === 'temp' ? now + TEMP_TTL_MS : null,
      createdAt: new Date(now).toISOString(),
    };
    this.database.run(
      `INSERT INTO users (id, username, password_hash, nickname, kind, expires_at, touched_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      user.id,
      user.username,
      user.passwordHash,
      user.nickname,
      user.kind,
      user.expiresAt,
      now,
      now,
    );
    return user;
  }

  private map(row: UserRow): StoredUser {
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      nickname: row.nickname,
      kind: row.kind === 'temp' ? 'temp' : 'formal',
      expiresAt: row.expires_at == null ? null : Number(row.expires_at),
      createdAt: new Date(Number(row.created_at)).toISOString(),
    };
  }
}
