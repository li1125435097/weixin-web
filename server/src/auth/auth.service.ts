import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { cleanDisplayName, cleanPassword, cleanUsername } from '../common/names';
import { UsersService } from '../users/users.service';
import { PublicUser } from '../users/users.types';
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
  ) {}

  async register(body: { username?: unknown; password?: unknown; nickname?: unknown }, ip: string): Promise<PublicUser> {
    this.limiter.hit(`register:${ip}`);
    const username = cleanUsername(body.username);
    const password = cleanPassword(body.password);
    const nickname = body.nickname == null || body.nickname === '' ? username : cleanDisplayName(body.nickname);
    const passwordHash = await this.passwords.hash(password);
    return this.users.create({ username, passwordHash, nickname });
  }

  async login(body: { username?: unknown; password?: unknown }, ip: string): Promise<PublicUser> {
    this.limiter.hit(`login:${ip}`);
    const username = cleanUsername(body.username);
    const password = cleanPassword(body.password);
    const user = await this.users.findByUsername(username);
    const ok = await this.passwords.verify(password, user?.passwordHash);
    if (!user || !ok) {
      throw new UnauthorizedException('用户名或密码不正确');
    }
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      createdAt: user.createdAt,
    };
  }

  async me(req: Request): Promise<PublicUser> {
    const claims = this.tokens.readUser(req.cookies?.[SESSION_COOKIE]);
    if (!claims) throw new UnauthorizedException('请先登录');
    const user = await this.users.findById(claims.sub);
    if (!user) throw new UnauthorizedException('请先登录');
    return user;
  }

  writeSession(res: Response, user: { id: string; username: string }): void {
    res.cookie(SESSION_COOKIE, this.tokens.signUser(user), cookieOptions(WEEK_MS));
  }

  clearSession(res: Response): void {
    res.clearCookie(SESSION_COOKIE, cookieOptions(0));
  }
}
