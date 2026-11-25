import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ChatService, ConversationSummary } from '../chat/chat.service';
import { SessionService } from '../chat/session.service';
import { RealtimeService } from './realtime.service';
import { RoomsService } from './rooms.service';

@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly chat: ChatService,
    private readonly session: SessionService,
    private readonly rooms: RoomsService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get()
  list(@Req() req: Request) {
    const user = this.session.require(req);
    return { conversations: this.chat.list(user.id).map((row) => this.decorate(row, user.id)) };
  }

  @Post('direct')
  @HttpCode(200)
  direct(@Body() body: { userId?: unknown }, @Req() req: Request) {
    const user = this.session.requireFormal(req);
    const friendId = typeof body.userId === 'string' ? body.userId : '';
    const id = this.chat.openDirect(user.id, friendId);
    const row = this.chat.list(user.id).find((item) => item.id === id);
    return row ? this.decorate(row, user.id) : { id };
  }

  @Get(':id/messages')
  messages(@Param('id') id: string, @Req() req: Request) {
    const user = this.session.require(req);
    const result = this.chat.messages(id, user.id);
    if (result.peerId) this.realtime.toUser(result.peerId, 'chat:read', { conversationId: id, readAt: result.readAt });
    return { messages: result.messages };
  }

  @Post(':id/call')
  @HttpCode(200)
  call(@Param('id') id: string, @Req() req: Request) {
    const user = this.session.require(req);
    return this.rooms.summary(this.rooms.ensureCall(id, user));
  }

  private decorate(row: ConversationSummary, userId: string) {
    const room = this.rooms.byConversation(row.id);
    const role = room ? (room.ownerId === userId ? 'owner' : room.guest?.id === userId ? 'guest' : null) : null;
    return {
      ...row,
      roomId: room?.id ?? null,
      roomStatus: room?.status ?? null,
      callFrom: room?.callFrom ?? null,
      role,
      invitePath: room && room.ownerId === userId ? `/join/${room.id}` : null,
    };
  }
}
