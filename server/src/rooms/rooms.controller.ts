import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { cleanDisplayName } from '../common/names';
import { SessionService } from '../chat/session.service';
import { Member } from './room.types';
import { RoomsService } from './rooms.service';
import { TurnService } from './turn.service';

@Controller('rooms')
export class RoomsController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly session: SessionService,
    private readonly auth: AuthService,
    private readonly turnService: TurnService,
  ) {}

  @Post()
  create(@Req() req: Request) {
    const user = this.session.requireFormal(req);
    return this.rooms.summary(this.rooms.create(user));
  }

  @Get()
  list(@Req() req: Request) {
    const user = this.session.require(req);
    return { rooms: this.rooms.list(user.id) };
  }

  @Get(':id')
  detail(@Param('id') id: string, @Req() req: Request) {
    const room = this.rooms.peek(id);
    if (!room) throw new NotFoundException('房间不存在或已结束');
    return this.rooms.describe(room, this.viewer(req, room.ownerId, room.guest?.id));
  }

  @Post('join')
  @HttpCode(200)
  join(@Body() body: { roomId?: unknown; nickname?: unknown }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const roomId = typeof body.roomId === 'string' ? body.roomId : '';
    const current = this.session.current(req);
    const nickname = !current || current.kind !== 'formal' ? cleanDisplayName(body.nickname, '你的名字') : null;
    const user = this.auth.participant(current, nickname);
    this.auth.writeSession(res, { id: user.id, username: user.username || '' });
    const seat = this.rooms.reserveGuest(roomId, {
      id: user.id,
      name: this.auth.seatName(user),
      username: user.username || undefined,
    });
    return {
      roomId,
      conversationId: seat.conversationId,
      nickname: this.auth.seatName(user),
      ownerName: seat.ownerName,
      expiresAt: seat.expiresAt,
    };
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(@Param('id') id: string, @Req() req: Request) {
    this.rooms.accept(id, this.actor(req, id));
    return { ok: true };
  }

  @Post(':id/end')
  @HttpCode(200)
  end(@Param('id') id: string, @Req() req: Request) {
    this.rooms.finishCall(id, this.actor(req, id));
    return { ok: true };
  }

  @Get(':id/turn')
  turn(@Param('id') id: string, @Req() req: Request) {
    const actor = this.actor(req, id);
    return { iceServers: this.turnService.iceServers(actor.id) };
  }

  private viewer(req: Request, ownerId: string, guestId?: string): 'owner' | 'guest' | 'none' {
    const user = this.session.current(req);
    if (!user) return 'none';
    if (user.id === ownerId) return 'owner';
    if (guestId && user.id === guestId) return 'guest';
    return 'none';
  }

  private actor(req: Request, roomId: string): Member {
    const room = this.rooms.peek(roomId);
    if (!room) throw new NotFoundException('房间不存在或已结束');
    const user = this.session.current(req);
    if (!user) throw new UnauthorizedException('请先登录或通过邀请链接进入');
    if (user.id === room.ownerId) return { role: 'owner', id: user.id, name: room.ownerName, socketId: room.ownerSocketId || '' };
    if (room.guest?.id === user.id) return { role: 'guest', id: user.id, name: room.guest.name, socketId: room.guest.socketId || '' };
    throw new UnauthorizedException('请先登录或通过邀请链接进入');
  }
}
