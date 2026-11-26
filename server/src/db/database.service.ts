import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { mkdirSync, readFileSync, renameSync, existsSync } from 'fs';
import { DatabaseSync, type SqlValue } from 'node:sqlite';
import path from 'path';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: DatabaseSync;

  constructor() {
    const dir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, 'app.db'));
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
    this.importUsers(path.join(dir, 'users.json'));
  }

  onModuleDestroy(): void {
    this.db.close();
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw error;
    }
  }

  get(sql: string, ...params: SqlValue[]): Record<string, SqlValue> | undefined {
    return this.db.prepare(sql).get(...params);
  }

  all(sql: string, ...params: SqlValue[]): Array<Record<string, SqlValue>> {
    return this.db.prepare(sql).all(...params);
  }

  run(sql: string, ...params: SqlValue[]): void {
    this.db.prepare(sql).run(...params);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        password_hash TEXT,
        nickname TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL,
        expires_at INTEGER,
        touched_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS friendships (
        user_id TEXT NOT NULL,
        friend_id TEXT NOT NULL,
        system INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, friend_id)
      );
      CREATE TABLE IF NOT EXISTS friend_requests (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS friend_requests_to ON friend_requests(to_id, status);
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS members (
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        last_read_at INTEGER NOT NULL DEFAULT 0,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        duration_ms INTEGER,
        mime TEXT,
        name TEXT
      );
      CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS messages_sender ON messages(sender_id, type, created_at);
      CREATE INDEX IF NOT EXISTS users_temp_expiry ON users(kind, expires_at);
    `);
    const columns = this.db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'name')) {
      this.db.exec('ALTER TABLE messages ADD COLUMN name TEXT');
    }
  }

  private importUsers(file: string): void {
    if (!existsSync(file)) return;
    let parsed: { users?: Array<Record<string, unknown>> };
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8')) as { users?: Array<Record<string, unknown>> };
    } catch {
      return;
    }
    const rows = Array.isArray(parsed.users) ? parsed.users : [];
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO users (id, username, password_hash, nickname, kind, expires_at, touched_at, created_at)
       VALUES (?, ?, ?, ?, 'formal', NULL, ?, ?)`,
    );
    const now = Date.now();
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || typeof row.username !== 'string' || typeof row.passwordHash !== 'string') continue;
      const created = typeof row.createdAt === 'string' ? Date.parse(row.createdAt) : now;
      insert.run(row.id, row.username, row.passwordHash, typeof row.nickname === 'string' ? row.nickname : row.username, now, Number.isFinite(created) ? created : now);
    }
    const imported = `${file}.imported`;
    renameSync(file, existsSync(imported) ? `${file}.${Date.now()}.imported` : imported);
  }
}
