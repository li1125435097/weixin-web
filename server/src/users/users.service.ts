import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';
import { newId } from '../common/ids';
import { PublicUser, StoredUser, toPublic, UserDatabase } from './users.types';

@Injectable()
export class UsersService {
  private readonly file: string;
  private tail: Promise<void> = Promise.resolve();

  constructor() {
    const dir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    this.file = path.join(dir, 'users.json');
  }

  async findByUsername(username: string): Promise<StoredUser | null> {
    const db = await this.read();
    return db.users.find((user) => user.username === username) ?? null;
  }

  async findById(id: string): Promise<PublicUser | null> {
    const db = await this.read();
    const user = db.users.find((item) => item.id === id);
    return user ? toPublic(user) : null;
  }

  async create(input: { username: string; passwordHash: string; nickname: string }): Promise<PublicUser> {
    return this.enqueue(async () => {
      const db = await this.read();
      if (db.users.some((user) => user.username === input.username)) {
        throw new ConflictException('用户名已存在');
      }
      const user: StoredUser = {
        id: newId('u'),
        username: input.username,
        passwordHash: input.passwordHash,
        nickname: input.nickname,
        createdAt: new Date().toISOString(),
      };
      db.users.push(user);
      await this.write(db);
      return toPublic(user);
    });
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job, job);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async read(): Promise<UserDatabase> {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const data = JSON.parse(raw) as UserDatabase;
      if (!data || !Array.isArray(data.users)) {
        throw new Error('bad shape');
      }
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { users: [] };
      }
      throw new ServiceUnavailableException('用户数据文件无法读取');
    }
  }

  private async write(db: UserDatabase): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }
}
