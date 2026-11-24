import { Injectable, Logger } from '@nestjs/common';
import jwt, { type JwtPayload } from 'jsonwebtoken';

export interface UserClaims {
  typ: 'user';
  sub: string;
  username: string;
}

export interface GuestClaims {
  typ: 'guest';
  sub: string;
  roomId: string;
  name: string;
}

@Injectable()
export class TokenService {
  private readonly secret: string;
  private readonly logger = new Logger(TokenService.name);

  constructor() {
    const configured = process.env.JWT_SECRET || '';
    if (configured.length < 16) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET 至少需要 16 位');
      }
      this.secret = 'dev-only-webcall-secret';
      this.logger.warn('未设置 JWT_SECRET，当前使用仅供本机开发的默认值');
    } else {
      this.secret = configured;
    }
  }

  signUser(user: { id: string; username: string }): string {
    return jwt.sign({ typ: 'user', sub: user.id, username: user.username }, this.secret, { expiresIn: '7d' });
  }

  signGuest(guest: { id: string; roomId: string; name: string }, expiresInSec: number): string {
    const ttl = Math.max(60, Math.min(expiresInSec, 60 * 60 * 24));
    return jwt.sign({ typ: 'guest', sub: guest.id, roomId: guest.roomId, name: guest.name }, this.secret, {
      expiresIn: ttl,
    });
  }

  readUser(token: string | undefined): UserClaims | null {
    const payload = this.verify(token);
    if (!payload || payload.typ !== 'user' || !payload.sub || !payload.username) return null;
    return { typ: 'user', sub: payload.sub, username: payload.username };
  }

  readGuest(token: string | undefined): GuestClaims | null {
    const payload = this.verify(token);
    if (!payload || payload.typ !== 'guest' || !payload.sub || !payload.roomId) return null;
    return {
      typ: 'guest',
      sub: payload.sub,
      roomId: String(payload.roomId),
      name: typeof payload.name === 'string' ? payload.name : '访客',
    };
  }

  private verify(token: string | undefined): TokenPayload | null {
    if (!token) return null;
    try {
      const payload = jwt.verify(token, this.secret);
      return typeof payload === 'string' ? null : (payload as TokenPayload);
    } catch {
      return null;
    }
  }
}

interface TokenPayload extends JwtPayload {
  typ?: string;
  username?: string;
  roomId?: string;
  name?: string;
}
