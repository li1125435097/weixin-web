import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { cleanUsername } from '../common/names';
import { ChatService } from './chat.service';
import { SessionService } from './session.service';

@Controller('friends')
export class FriendsController {
  constructor(
    private readonly chat: ChatService,
    private readonly session: SessionService,
  ) {}

  @Get()
  list(@Req() req: Request) {
    const user = this.session.require(req);
    return this.chat.friends(user.id);
  }

  @Post('requests')
  @HttpCode(200)
  request(@Body() body: { username?: unknown }, @Req() req: Request) {
    const user = this.session.requireFormal(req);
    this.chat.requestFriend(user.id, cleanUsername(body.username));
    return { ok: true };
  }

  @Post('requests/:id/accept')
  @HttpCode(200)
  accept(@Param('id') id: string, @Req() req: Request) {
    const user = this.session.requireFormal(req);
    this.chat.accept(user.id, id);
    return { ok: true };
  }

  @Post('requests/:id/reject')
  @HttpCode(200)
  reject(@Param('id') id: string, @Req() req: Request) {
    const user = this.session.requireFormal(req);
    this.chat.reject(user.id, id);
    return { ok: true };
  }
}
