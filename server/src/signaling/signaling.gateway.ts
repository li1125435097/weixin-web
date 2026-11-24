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
import { GUEST_COOKIE, SESSION_COOKIE } from '../auth/cookies';
import { TokenService } from '../auth/token.service';
import { errorMessage } from '../common/fail';
import { normalizeChat } from '../messages/chat-policy';
import { RealtimeService } from '../rooms/realtime.service';
import { MemberRole } from '../rooms/room.types';
import { RoomsService } from '../rooms/rooms.service';

interface SocketMeta {
  roomId: string;
  role: MemberRole;
  id: string;
  name: string;
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
    if (!meta) return;
    this.rooms.detach(meta.roomId, meta.role, client.id);
  }

  @SubscribeMessage('room:join')
  join(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId?: string }) {
    try {
      const roomId = typeof body?.roomId === 'string' ? body.roomId : '';
      this.rooms.must(roomId);
      const member = this.identify(client, roomId);
      if (!member) return { ok: false, message: '请先登录或通过邀请链接进入' };
      const attached = this.rooms.attach(roomId, { ...member, socketId: client.id });
      const room = this.rooms.must(roomId);
      this.metas.set(client.id, { roomId, role: member.role, id: member.id, name: member.name });
      client.emit('room:joined', {
        roomId,
        role: member.role,
        status: room.status,
        reconnected: attached.reconnected,
        selfName: member.name,
        peerName: member.role === 'owner' ? room.guest?.name || '' : room.ownerName,
        peerOnline: Boolean(member.role === 'owner' ? room.guest?.socketId : room.ownerSocketId),
        expiresAt: room.expiresAt,
        callFrom: room.callFrom ?? null,
      });
      if (attached.replacedSocketId) {
        this.realtime.to(attached.replacedSocketId, 'call:end', { roomId, reason: 'replaced' });
        this.realtime.disconnect(attached.replacedSocketId);
      }
      const peerSocket = member.role === 'owner' ? room.guest?.socketId : room.ownerSocketId;
      if (peerSocket) this.realtime.to(peerSocket, 'peer:online', { roomId, name: member.name });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  @SubscribeMessage('call:invite')
  invite(@ConnectedSocket() client: Socket) {
    const meta = this.metas.get(client.id);
    if (!meta) return { ok: false, message: '未加入房间' };
    try {
      this.rooms.invite(meta.roomId, meta);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  @SubscribeMessage('call:accept')
  accept(@ConnectedSocket() client: Socket) {
    const meta = this.metas.get(client.id);
    if (!meta) return { ok: false, message: '未加入房间' };
    try {
      this.rooms.accept(meta.roomId, meta);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  @SubscribeMessage('call:reject')
  reject(@ConnectedSocket() client: Socket) {
    const meta = this.metas.get(client.id);
    if (!meta) return { ok: false, message: '未加入房间' };
    try {
      this.rooms.reject(meta.roomId, meta);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  @SubscribeMessage('call:end')
  end(@ConnectedSocket() client: Socket) {
    const meta = this.metas.get(client.id);
    if (!meta) return { ok: false, message: '未加入房间' };
    try {
      this.rooms.finishCall(meta.roomId, meta);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  @SubscribeMessage('room:close')
  close(@ConnectedSocket() client: Socket) {
    const meta = this.metas.get(client.id);
    if (!meta) return { ok: false, message: '未加入房间' };
    try {
      this.rooms.close(meta.roomId, meta);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
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
  chat(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    const meta = this.metas.get(client.id);
    if (!meta) return { ok: false, message: '未加入房间' };
    if (!this.allowChat(client.id)) return { ok: false, message: '发送太快了' };
    const peer = this.rooms.peer(meta.roomId, meta.role, client.id);
    if (!peer) return { ok: false, message: '对方不在线' };
    try {
      const message = normalizeChat(body, meta.role, meta.name);
      this.realtime.to(peer.socketId, 'chat:new', message);
      this.realtime.to(client.id, 'chat:new', message);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  private relay(client: Socket, event: string, body: unknown, kind: 'offer' | 'answer' | 'ice') {
    const meta = this.metas.get(client.id);
    if (!meta) return { ok: false, message: '未加入房间' };
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

  private identify(client: Socket, roomId: string): { role: MemberRole; id: string; name: string } | null {
    const header = client.handshake.headers.cookie;
    const room = this.rooms.peek(roomId);
    if (!room) return null;
    const session = this.tokens.readUser(readCookie(header, SESSION_COOKIE));
    if (session && session.sub === room.ownerId) {
      return { role: 'owner', id: session.sub, name: room.ownerName };
    }
    const guest = this.tokens.readGuest(readCookie(header, GUEST_COOKIE));
    if (guest && guest.roomId === roomId && room.guest?.id === guest.sub) {
      return { role: 'guest', id: guest.sub, name: room.guest.name };
    }
    return null;
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
  if (desc.type !== type || typeof desc.sdp !== 'string' || desc.sdp.length === 0 || desc.sdp.length > 100_000) {
    return null;
  }
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
