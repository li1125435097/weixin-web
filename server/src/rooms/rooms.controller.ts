import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { cleanDisplayName } from '../common/names';
import { GUEST_COOKIE, cookieOptions, SESSION_COOKIE } from '../auth/cookies';
import { TokenService } from '../auth/token.service';
import { UsersService } from '../users/users.service';
import { Member } from './room.types';
import { RoomsService } from './rooms.service';
import { TurnService } from './turn.service';

@Controller('rooms')
export class RoomsController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
    private readonly turnService: TurnService,
  ) {}

  @Post()
  async create(@Req() req: Request) {
    const user = await this.requireUser(req);
    const room = this.rooms.create(user);
    return this.rooms.summary(room);
  }

  @Get()
  async list(@Req() req: Request) {
    const user = await this.requireUser(req);
    return { rooms: this.rooms.list(user.id) };
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Req() req: Request) {
    const room = this.rooms.peek(id);
    if (!room) throw new NotFoundException('房间不存在或已结束');
    return this.rooms.describe(room, await this.viewer(req, room.id, room.ownerId, room.guest?.id));
  }

  @Post('join')
  @HttpCode(200)
  async join(
    @Body() body: { roomId?: unknown; nickname?: unknown },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const roomId = typeof body.roomId === 'string' ? body.roomId : '';
    const nickname = cleanDisplayName(body.nickname, '你的名字');
    const claims = this.tokens.readUser(req.cookies?.[SESSION_COOKIE]);
    const account = claims ? await this.users.findById(claims.sub) : null;
    const seat = this.rooms.reserveGuest(roomId, nickname, account?.username);
    const ttl = Math.floor((seat.expiresAt - Date.now()) / 1000);
    const token = this.tokens.signGuest({ id: seat.guestId, roomId, name: nickname }, ttl);
    res.cookie(GUEST_COOKIE, token, cookieOptions(Math.max(ttl, 60) * 1000));
    return { roomId, guestId: seat.guestId, nickname, ownerName: seat.ownerName, expiresAt: seat.expiresAt };
  }

  @Post(':id/accept')
  @HttpCode(200)
  async accept(@Param('id') id: string, @Req() req: Request) {
    const actor = await this.actor(req, id);
    this.rooms.accept(id, actor);
    return { ok: true };
  }

  @Post(':id/end')
  @HttpCode(200)
  async end(@Param('id') id: string, @Req() req: Request) {
    const actor = await this.actor(req, id);
    this.rooms.finishCall(id, actor);
    return { ok: true };
  }

  @Get(':id/turn')
  async turn(@Param('id') id: string, @Req() req: Request) {
    const actor = await this.actor(req, id);
    return { iceServers: this.turnService.iceServers(actor.id) };
  }

  private async requireUser(req: Request) {
    const claims = this.tokens.readUser(req.cookies?.[SESSION_COOKIE]);
    if (!claims) throw new UnauthorizedException('请先登录');
    const user = await this.users.findById(claims.sub);
    if (!user) throw new UnauthorizedException('请先登录');
    return user;
  }

  private async viewer(req: Request, roomId: string, ownerId: string, guestId?: string): Promise<'owner' | 'guest' | 'none'> {
    const user = this.tokens.readUser(req.cookies?.[SESSION_COOKIE]);
    if (user?.sub === ownerId) return 'owner';
    const guest = this.tokens.readGuest(req.cookies?.[GUEST_COOKIE]);
    if (guest && guest.roomId === roomId && guest.sub === guestId) return 'guest';
    return 'none';
  }

  private async actor(req: Request, roomId: string): Promise<Member> {
    const room = this.rooms.peek(roomId);
    if (!room) throw new NotFoundException('房间不存在或已结束');
    const user = this.tokens.readUser(req.cookies?.[SESSION_COOKIE]);
    if (user?.sub === room.ownerId) {
      return { role: 'owner', id: user.sub, name: room.ownerName, socketId: room.ownerSocketId || '' };
    }
    const guest = this.tokens.readGuest(req.cookies?.[GUEST_COOKIE]);
    if (guest && guest.roomId === roomId && room.guest?.id === guest.sub) {
      return { role: 'guest', id: guest.sub, name: room.guest.name, socketId: room.guest.socketId || '' };
    }
    throw new UnauthorizedException('请先登录或通过邀请链接进入');
  }
}
