import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { SESSION_COOKIE } from '../auth/cookies';
import { TokenService } from '../auth/token.service';
import { StoredUser } from '../users/users.types';
import { UsersService } from '../users/users.service';
import { ChatService } from './chat.service';

@Injectable()
export class SessionService {
  constructor(
    private readonly tokens: TokenService,
    private readonly users: UsersService,
    private readonly chat: ChatService,
  ) {}

  current(req: Request): StoredUser | null {
    const claims = this.tokens.readUser(req.cookies?.[SESSION_COOKIE]);
    if (!claims) return null;
    const user = this.users.findStored(claims.sub);
    if (!user) return null;
    if (user.kind === 'temp' && user.expiresAt !== null && user.expiresAt <= Date.now()) {
      this.chat.purgeUser(user.id);
      return null;
    }
    this.users.touch(user);
    return user;
  }

  require(req: Request): StoredUser {
    const user = this.current(req);
    if (!user) throw new UnauthorizedException('请先登录');
    return user;
  }

  requireFormal(req: Request): StoredUser {
    const user = this.require(req);
    if (user.kind !== 'formal') throw new ForbiddenException('请先登录');
    return user;
  }
}
