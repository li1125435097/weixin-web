import { OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { displayNameOf } from '../common/admin';
import { SESSION_COOKIE } from '../auth/cookies';
import { TokenService } from '../auth/token.service';
import { ChatService } from '../chat/chat.service';
import { errorMessage } from '../common/fail';
import { normalizeChat } from '../messages/chat-policy';
import { RealtimeService } from '../rooms/realtime.service';
import { MemberRole, Room } from '../rooms/room.types';
import { RoomsService } from '../rooms/rooms.service';
import { UsersService } from '../users/users.service';
import { StoredUser } from '../users/users.types';

interface SocketMeta {
  conversationId: string;
  userId: string;
  name: string;
  roomId?: string;
  role?: MemberRole;
}

@WebSocketGateway({ cors: { origin: true, credentials: true }, maxHttpBufferSize: 2_000_000 })
export class SignalingGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server!: Server;

  private readonly metas = new Map<string, SocketMeta>();
  private readonly chatHits = new Map<string, number[]>();

  constructor(
    private readonly rooms: RoomsService,
    private readonly tokens: TokenService,
    private readonly realtime: RealtimeService,
    private readonly chat: ChatService,
    private readonly users: UsersService,
  ) {}

  onModuleInit(): void {
    this.rooms.setListener((ids, event, payload) => {
      for (const id of ids) this.realtime.to(id, event, payload);
    });
  }

  afterInit(): void {
    this.realtime.bind(this.server);
  }

  handleDisconnect(client: Socket): void {
    const meta = this.metas.get(client.id);
    this.metas.delete(client.id);
    this.chatHits.delete(client.id);
    this.realtime.unbind(client.id);
    if (meta && this.realtime.userSockets(meta.userId).length === 0) {
      const peerId = this.chat.memberIds(meta.conversationId).find((id) => id !== meta.userId);
      if (peerId) this.realtime.toUser(peerId, 'peer:offline', { conversationId: meta.conversationId });
    }
    if (!meta?.roomId || !meta.role) return;
    this.rooms.detach(meta.roomId, meta.role, client.id);
  }

  @SubscribeMessage('conversation:join')
  join(@ConnectedSocket() client: Socket, @MessageBody() body: { conversationId?: string }) {
    try {
      const user = this.currentUser(client);
      if (!user) return { ok: false, message: '请先登录' };
      const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : '';
      this.chat.assertMember(conversationId, user.id);
      const name = displayNameOf(user);
      const previous = this.metas.get(client.id);
      if (previous && previous.conversationId !== conversationId) {
        if (previous.roomId && previous.role) this.rooms.detach(previous.roomId, previous.role, client.id);
        const oldPeerId = this.chat.memberIds(previous.conversationId).find((id) => id !== user.id);
        const stillHere = this.realtime.userSockets(user.id).some((socketId) => {
          if (socketId === client.id) return false;
          return this.metas.get(socketId)?.conversationId === previous.conversationId;
        });
        if (oldPeerId && !stillHere) this.realtime.toUser(oldPeerId, 'peer:offline', { conversationId: previous.conversationId });
      }
      this.metas.set(client.id, { conversationId, userId: user.id, name });
      this.realtime.bindUser(user.id, client.id);
      const summary = this.chat.list(user.id).find((item) => item.id === conversationId);
      const room = this.rooms.prepare(conversationId, user);
      let roomState: Record<string, unknown> | null = null;
      if (room && (room.ownerId === user.id || room.guest?.id === user.id)) {
        const role: MemberRole = room.ownerId === user.id ? 'owner' : 'guest';
        roomState = this.bindRoom(client.id, room, role, name);
      }
      const readAt = Date.now();
      this.chat.markRead(conversationId, user.id, readAt);
      const peerId = summary?.peerId ?? null;
      if (peerId) {
        this.realtime.toUser(peerId, 'chat:read', { conversationId, readAt });
        this.realtime.toUser(peerId, 'peer:online', { conversationId, name });
      }
      client.emit('conversation:state', {
        ...(roomState || { role: null, roomId: null, status: null, callFrom: null, peerOnline: false }),
        conversationId,
        kind: summary?.kind ?? 'invite',
        selfId: user.id,
        selfName: name,
        peerName: summary?.peerId ? summary.title : '',
        peerJoined: Boolean(summary?.peerId),
        peerOnline: peerId ? this.realtime.userSockets(peerId).some((id) => id !== client.id) : false,
        invitePath: room && room.ownerId === user.id ? `/join/${room.id}` : null,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  @SubscribeMessage('call:invite')
  invite(@ConnectedSocket() client: Socket) {
    const meta = this.metas.get(client.id);
    if (!meta) return { ok: false, message: '未加入聊天' };
    try {
      const user = this.users.findStored(meta.userId);
      if (!user) return { ok: false, message: '请先登录' };
      const room = this.rooms.ensureCall(meta.conversationId, user);
      const role: MemberRole = room.ownerId === user.id ? 'owner' : 'guest';
      this.bindRoom(client.id, room, role, meta.name);
      const peerId = room.ownerId === user.id ? room.guest?.id : room.ownerId;
      if (peerId) {
        for (const socketId of this.realtime.userSockets(peerId)) {
          const peer = this.metas.get(socketId);
          if (!peer || peer.conversationId !== meta.conversationId) continue;
          const peerRole: MemberRole = room.ownerId === peerId ? 'owner' : 'guest';
          this.bindRoom(socketId, room, peerRole, peer.name);
        }
      }
      this.rooms.invite(room.id, { role, id: user.id, name: meta.name });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  @SubscribeMessage('call:accept')
  accept(@ConnectedSocket() client: Socket) {
    return this.withRoom(client, (roomId, actor) => this.rooms.accept(roomId, actor));
  }

  @SubscribeMessage('call:reject')
  reject(@ConnectedSocket() client: Socket) {
    return this.withRoom(client, (roomId, actor) => this.rooms.reject(roomId, actor));
  }

  @SubscribeMessage('call:end')
  end(@ConnectedSocket() client: Socket) {
    return this.withRoom(client, (roomId, actor) => this.rooms.finishCall(roomId, actor));
  }

  @SubscribeMessage('room:close')
  close(@ConnectedSocket() client: Socket) {
    return this.withRoom(client, (roomId, actor) => this.rooms.close(roomId, actor));
  }

  @SubscribeMessage('webrtc:offer')
  offer(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    return this.relay(client, 'webrtc:offer', body, 'offer');
  }

  @SubscribeMessage('webrtc:answer')
  answer(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    return this.relay(client, 'webrtc:answer', body, 'answer');
  }

  @SubscribeMessage('webrtc:ice')
  ice(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    return this.relay(client, 'webrtc:ice', body, 'ice');
  }

  @SubscribeMessage('chat:send')
  chatMessage(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    const meta = this.metas.get(client.id);
    if (!meta) return { ok: false, message: '未加入聊天' };
    if (!this.allowChat(client.id)) return { ok: false, message: '发送太快了' };
    try {
      const draft = normalizeChat(body);
      const saved = this.chat.send(meta.conversationId, meta.userId, draft);
      let message = saved.message;
      const members = this.chat.memberIds(meta.conversationId);
      const peerId = members.find((id) => id !== meta.userId);
      const watching = peerId
        ? [...this.metas.values()].some((item) => item.userId === peerId && item.conversationId === meta.conversationId)
        : false;
      if (peerId && watching) {
        const readAt = Date.now();
        this.chat.markRead(meta.conversationId, peerId, readAt);
        message = { ...message, read: true };
        this.realtime.toUser(meta.userId, 'chat:read', { conversationId: meta.conversationId, readAt });
      }
      for (const memberId of members) this.realtime.toUser(memberId, 'chat:new', message);
      if (saved.deletedIds.length > 0) {
        for (const memberId of members) this.realtime.toUser(memberId, 'chat:trim', { conversationId: meta.conversationId, ids: saved.deletedIds });
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  private withRoom(client: Socket, fn: (roomId: string, actor: { role: MemberRole; id: string; name: string }) => void) {
    const meta = this.metas.get(client.id);
    if (!meta?.roomId || !meta.role) return { ok: false, message: '未加入房间' };
    try {
      fn(meta.roomId, { role: meta.role, id: meta.userId, name: meta.name });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  private bindRoom(socketId: string, room: Room, role: MemberRole, name: string) {
    const meta = this.metas.get(socketId);
    if (!meta) return null;
    const memberId = role === 'owner' ? room.ownerId : room.guest?.id;
    if (!memberId) return null;
    meta.roomId = room.id;
    meta.role = role;
    const attached = this.rooms.attach(room.id, { role, id: memberId, name, socketId });
    if (attached.replacedSocketId) {
      this.realtime.to(attached.replacedSocketId, 'call:end', { roomId: room.id, reason: 'replaced' });
      this.realtime.disconnect(attached.replacedSocketId);
    }
    const payload = {
      roomId: room.id,
      conversationId: room.conversationId,
      role,
      status: room.status,
      reconnected: attached.reconnected,
      selfName: name,
      peerName: role === 'owner' ? room.guest?.name || '' : room.ownerName,
      peerOnline: Boolean(role === 'owner' ? room.guest?.socketId : room.ownerSocketId),
      expiresAt: room.expiresAt,
      callFrom: room.callFrom ?? null,
    };
    this.realtime.to(socketId, 'room:joined', payload);
    return payload;
  }

  private relay(client: Socket, event: string, body: unknown, kind: 'offer' | 'answer' | 'ice') {
    const meta = this.metas.get(client.id);
    if (!meta?.roomId || !meta.role) return { ok: false, message: '未加入房间' };
    const peer = this.rooms.peer(meta.roomId, meta.role, client.id);
    if (!peer) return { ok: false, message: '对方不在线' };
    if (peer.status !== 'active') return { ok: false, message: '通话还没开始' };
    if (kind === 'ice') {
      const candidate = cleanIce(body);
      if (!candidate) return { ok: true };
      this.realtime.to(peer.socketId, event, { candidate });
      return { ok: true };
    }
    const sdp = cleanSdp(body, kind);
    if (!sdp) return { ok: false, message: '信令无效' };
    this.realtime.to(peer.socketId, event, { sdp });
    return { ok: true };
  }

  private currentUser(client: Socket): StoredUser | null {
    const session = this.tokens.readUser(readCookie(client.handshake.headers.cookie, SESSION_COOKIE));
    if (!session) return null;
    return this.users.findStored(session.sub);
  }

  private allowChat(socketId: string): boolean {
    const now = Date.now();
    const recent = (this.chatHits.get(socketId) ?? []).filter((stamp) => now - stamp < 5000);
    if (recent.length >= 10) {
      this.chatHits.set(socketId, recent);
      return false;
    }
    recent.push(now);
    this.chatHits.set(socketId, recent);
    return true;
  }
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function cleanSdp(input: unknown, type: 'offer' | 'answer'): { type: 'offer' | 'answer'; sdp: string } | null {
  if (!input || typeof input !== 'object') return null;
  const raw = (input as { sdp?: unknown }).sdp;
  if (!raw || typeof raw !== 'object') return null;
  const desc = raw as { type?: unknown; sdp?: unknown };
  if (desc.type !== type || typeof desc.sdp !== 'string' || desc.sdp.length === 0 || desc.sdp.length > 100_000) return null;
  return { type, sdp: desc.sdp };
}

function cleanIce(input: unknown): { candidate: string; sdpMid?: string; sdpMLineIndex?: number } | null {
  if (!input || typeof input !== 'object') return null;
  const raw = (input as { candidate?: unknown }).candidate;
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { candidate?: unknown; sdpMid?: unknown; sdpMLineIndex?: unknown };
  if (typeof candidate.candidate !== 'string' || candidate.candidate.length > 4000) return null;
  return {
    candidate: candidate.candidate,
    sdpMid: typeof candidate.sdpMid === 'string' ? candidate.sdpMid : undefined,
    sdpMLineIndex: typeof candidate.sdpMLineIndex === 'number' ? candidate.sdpMLineIndex : undefined,
  };
}
