import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { displayNameOf } from '../common/admin';
import { cleanDisplayName, cleanPassword, cleanUsername } from '../common/names';
import { ChatService } from '../chat/chat.service';
import { SessionService } from '../chat/session.service';
import { RoomsService } from '../rooms/rooms.service';
import { UsersService } from '../users/users.service';
import { PublicUser, StoredUser, toPublic } from '../users/users.types';
import { cookieOptions, SESSION_COOKIE } from './cookies';
import { PasswordService } from './password.service';
import { RateLimitService } from './rate-limit.service';
import { TokenService } from './token.service';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly limiter: RateLimitService,
    private readonly chat: ChatService,
    private readonly session: SessionService,
    private readonly rooms: RoomsService,
  ) {}

  async register(body: { username?: unknown; password?: unknown; nickname?: unknown }, ip: string, current: StoredUser | null): Promise<PublicUser> {
    this.limiter.hit(`register:${ip}`);
    const username = cleanUsername(body.username);
    const password = cleanPassword(body.password);
    const nickname = body.nickname == null || body.nickname === '' ? username : cleanDisplayName(body.nickname);
    const passwordHash = await this.passwords.hash(password);
    if (current?.kind === 'temp') {
      const user = this.users.promote(current.id, { username, passwordHash, nickname });
      this.attachAdmin(user.id, username);
      return toPublic(user);
    }
    const created = this.users.create({ username, passwordHash, nickname });
    this.attachAdmin(created.id, username);
    return created;
  }

  async login(body: { username?: unknown; password?: unknown }, ip: string, current: StoredUser | null): Promise<PublicUser> {
    this.limiter.hit(`login:${ip}`);
    const username = cleanUsername(body.username);
    const password = cleanPassword(body.password);
    const found = this.users.findByUsername(username);
    const ok = await this.passwords.verify(password, found?.passwordHash ?? undefined);
    if (!found || found.kind !== 'formal' || !ok) throw new UnauthorizedException('用户名或密码不正确');
    if (current?.kind === 'temp' && current.id !== found.id) {
      this.chat.mergeTemp(current.id, found.id);
      this.rooms.reassign(current.id, found);
      this.users.delete(current.id);
    }
    const user = this.users.findStored(found.id) || found;
    return toPublic(user);
  }

  guest(current: StoredUser | null): PublicUser {
    if (current) return toPublic(current);
    const user = this.users.createTemp('');
    this.chat.ensureAdmin(user.id);
    return toPublic(user);
  }

  participant(current: StoredUser | null, nickname: string | null): StoredUser {
    if (current?.kind === 'formal') return current;
    if (!nickname) throw new UnauthorizedException('请填写你的名字');
    if (current?.kind === 'temp') {
      this.users.setNickname(current.id, nickname);
      this.chat.ensureAdmin(current.id);
      return this.users.findStored(current.id) || { ...current, nickname };
    }
    const created = this.users.createTemp(nickname);
    this.chat.ensureAdmin(created.id);
    return created;
  }

  me(req: Request): PublicUser {
    const user = this.session.current(req);
    if (!user) throw new UnauthorizedException('请先登录');
    return toPublic(user);
  }

  writeSession(res: Response, user: { id: string; username: string }): void {
    res.cookie(SESSION_COOKIE, this.tokens.signUser(user), cookieOptions(WEEK_MS));
  }

  clearSession(res: Response): void {
    res.clearCookie(SESSION_COOKIE, cookieOptions(0));
  }

  seatName(user: StoredUser): string {
    return displayNameOf(user);
  }

  private attachAdmin(userId: string, username: string): void {
    if (username === 'lijinke') this.chat.backfillAdmin();
    else this.chat.ensureAdmin(userId);
  }
}
