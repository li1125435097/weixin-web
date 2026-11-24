import { ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { isRoomId, newId } from '../common/ids';
import { Member, Room, RoomListener } from './room.types';

const DEFAULT_TTL_SECONDS = 60 * 60 * 2;
const GRACE_MS = 20_000;
const GUEST_HOLD_MS = 90_000;
const RING_MS = 45_000;
const MAX_ROOMS_PER_OWNER = 5;
const VIDEO_USER = 'lijinke';
const VIDEO_DENIED = '请联系管理员3162853966@qq.com';

@Injectable()
export class RoomsService implements OnModuleDestroy {
  private readonly rooms = new Map<string, Room>();
  private listener: RoomListener | null = null;
  private readonly sweeper: NodeJS.Timeout;

  constructor() {
    this.sweeper = setInterval(() => this.sweep(), 15_000);
    this.sweeper.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
    for (const room of this.rooms.values()) this.erase(room);
  }

  setListener(listener: RoomListener): void {
    this.listener = listener;
  }

  ttlSeconds(): number {
    const parsed = Number(process.env.ROOM_TTL_SECONDS || DEFAULT_TTL_SECONDS);
    return Number.isFinite(parsed) && parsed >= 60 ? parsed : DEFAULT_TTL_SECONDS;
  }

  create(owner: { id: string; username: string; nickname: string }): Room {
    const open = [...this.rooms.values()].filter((room) => room.ownerId === owner.id);
    if (open.length >= MAX_ROOMS_PER_OWNER) {
      throw new ConflictException('进行中的房间太多，请先结束后再创建');
    }
    const now = Date.now();
    const room: Room = {
      id: newId(),
      ownerId: owner.id,
      ownerName: owner.nickname,
      ownerUsername: owner.username,
      status: 'waiting',
      createdAt: now,
      expiresAt: now + this.ttlSeconds() * 1000,
    };
    this.rooms.set(room.id, room);
    return room;
  }

  list(ownerId: string) {
    return [...this.rooms.values()]
      .filter((room) => room.ownerId === ownerId)
      .map((room) => this.summary(room));
  }

  must(roomId: string): Room {
    if (!isRoomId(roomId)) throw new NotFoundException('房间不存在或已结束');
    const room = this.rooms.get(roomId);
    if (!room || room.expiresAt <= Date.now()) {
      if (room) this.expire(room);
      throw new NotFoundException('房间不存在或已结束');
    }
    return room;
  }

  peek(roomId: string): Room | null {
    try {
      return this.must(roomId);
    } catch {
      return null;
    }
  }

  summary(room: Room) {
    return {
      id: room.id,
      status: room.status,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
      guestName: room.guest?.name ?? null,
      invitePath: `/join/${room.id}`,
      callFrom: room.callFrom ?? null,
    };
  }

  reserveGuest(roomId: string, name: string, username?: string): { guestId: string; expiresAt: number; ownerName: string } {
    const room = this.must(roomId);
    if (room.guest) throw new ConflictException('房间已有访客');
    const guestId = newId('g');
    room.guest = { id: guestId, name, username: username || undefined };
    this.armHold(room);
    return { guestId, expiresAt: room.expiresAt, ownerName: room.ownerName };
  }

  attach(roomId: string, member: Member): { reconnected: boolean; replacedSocketId?: string } {
    const room = this.must(roomId);
    if (member.role === 'owner') {
      if (member.id !== room.ownerId) throw new ForbiddenException('你不是这个房间的房主');
      const previous = room.ownerSocketId;
      this.clearTimer(room, 'owner');
      room.ownerSocketId = member.socketId;
      const reconnected = room.status === 'active' && previous !== member.socketId;
      return { reconnected, replacedSocketId: previous && previous !== member.socketId ? previous : undefined };
    }
    if (!room.guest || room.guest.id !== member.id) throw new ForbiddenException('请通过邀请链接进入');
    const previous = room.guest.socketId;
    const wasActive = room.status === 'active';
    this.clearTimer(room, 'guest');
    this.clearTimer(room, 'hold');
    room.guest.socketId = member.socketId;
    return {
      reconnected: wasActive,
      replacedSocketId: previous && previous !== member.socketId ? previous : undefined,
    };
  }

  detach(roomId: string, role: Member['role'], socketId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (role === 'owner') {
      if (room.ownerSocketId !== socketId) return;
      room.ownerSocketId = undefined;
      if (room.status === 'waiting') return;
      this.armGrace(room, 'owner');
      return;
    }
    if (!room.guest || room.guest.socketId !== socketId) return;
    room.guest.socketId = undefined;
    this.armGrace(room, 'guest');
  }

  invite(roomId: string, actor: { role: Member['role']; id: string; name: string }): void {
    const room = this.must(roomId);
    this.assertMember(room, actor);
    if (room.status === 'active') throw new ConflictException('已在通话中');
    if (room.status === 'ringing') throw new ConflictException('正在呼叫');
    if (actor.role === 'owner' && !room.guest) throw new ConflictException('对方还没加入');
    if (room.ownerUsername !== VIDEO_USER && room.guest?.username !== VIDEO_USER) {
      throw new ForbiddenException(VIDEO_DENIED);
    }
    room.callFrom = actor.role;
    room.status = 'ringing';
    this.armRing(room);
    const peerSocket = actor.role === 'owner' ? room.guest?.socketId : room.ownerSocketId;
    if (peerSocket) {
      this.publish([peerSocket], 'call:incoming', { roomId, callerName: actor.name, callFrom: actor.role });
    }
    const selfSocket = actor.role === 'owner' ? room.ownerSocketId : room.guest?.socketId;
    this.publish([selfSocket], 'call:outgoing', { roomId });
  }

  accept(roomId: string, actor: { role: Member['role']; id: string }): void {
    const room = this.must(roomId);
    this.assertMember(room, actor);
    if (room.status === 'active') return;
    if (room.status !== 'ringing' || !room.callFrom) throw new ConflictException('没有待接听的呼叫');
    if (room.callFrom === actor.role) throw new ForbiddenException('不能接听自己的呼叫');
    const callerOnline = room.callFrom === 'owner' ? Boolean(room.ownerSocketId) : Boolean(room.guest?.socketId);
    if (!callerOnline) throw new ConflictException('对方已离开');
    this.clearTimer(room, 'ring');
    room.status = 'active';
    this.publish([room.ownerSocketId, room.guest?.socketId], 'call:accept', { roomId });
  }

  reject(roomId: string, actor: { role: Member['role']; id: string }): void {
    const room = this.must(roomId);
    this.assertMember(room, actor);
    if (room.status !== 'ringing') return;
    if (room.callFrom === actor.role) {
      this.finishCall(roomId, actor);
      return;
    }
    this.clearTimer(room, 'ring');
    room.status = 'waiting';
    room.callFrom = undefined;
    this.publish([room.ownerSocketId, room.guest?.socketId], 'call:reject', { roomId, by: actor.role });
  }

  finishCall(roomId: string, actor: { role: Member['role']; id: string }): void {
    const room = this.must(roomId);
    this.assertMember(room, actor);
    if (room.status === 'waiting') return;
    const ringing = room.status === 'ringing';
    const by = actor.role;
    this.clearTimer(room, 'ring');
    room.status = 'waiting';
    room.callFrom = undefined;
    const sockets = [room.ownerSocketId, room.guest?.socketId];
    if (ringing) this.publish(sockets, 'call:reject', { roomId, by });
    else this.publish(sockets, 'call:end', { roomId, reason: 'call-ended' });
  }

  close(roomId: string, actor: { role: Member['role']; id: string }): void {
    const room = this.must(roomId);
    this.assertMember(room, actor);
    if (actor.role !== 'owner') throw new ForbiddenException('只有房主可以结束聊天');
    const sockets = [room.ownerSocketId, room.guest?.socketId];
    this.erase(room);
    this.publish(sockets, 'call:end', { roomId, reason: 'closed' });
  }

  peer(roomId: string, role: Member['role'], socketId: string): { socketId: string; status: Room['status'] } | null {
    const room = this.rooms.get(roomId);
    if (!room || room.expiresAt <= Date.now()) return null;
    if (role === 'owner' && room.ownerSocketId !== socketId) return null;
    if (role === 'guest' && room.guest?.socketId !== socketId) return null;
    const other = role === 'owner' ? room.guest?.socketId : room.ownerSocketId;
    if (!other) return null;
    return { socketId: other, status: room.status };
  }

  describe(room: Room, viewer: 'owner' | 'guest' | 'none') {
    return {
      id: room.id,
      status: room.status,
      ownerNickname: room.ownerName,
      expiresAt: room.expiresAt,
      joinable: !room.guest,
      viewer,
      guestName: viewer === 'none' ? null : room.guest?.name ?? null,
    };
  }

  private assertMember(room: Room, actor: { role: Member['role']; id: string }): void {
    if (actor.role === 'owner' && actor.id === room.ownerId) return;
    if (actor.role === 'guest' && room.guest?.id === actor.id) return;
    throw new ForbiddenException('你不在这个房间里');
  }

  private armHold(room: Room): void {
    this.clearTimer(room, 'hold');
    room.guestHold = setTimeout(() => {
      if (!this.rooms.has(room.id) || room.guest?.socketId) return;
      this.clearGuest(room);
    }, GUEST_HOLD_MS);
  }

  private armGrace(room: Room, role: 'owner' | 'guest'): void {
    this.clearTimer(room, role);
    const peerSocket = role === 'owner' ? room.guest?.socketId : room.ownerSocketId;
    if (peerSocket) this.publish([peerSocket], 'peer:reconnecting', { roomId: room.id });
    const timer = setTimeout(() => {
      if (!this.rooms.has(room.id)) return;
      if (role === 'owner') {
        const guestSocket = room.guest?.socketId;
        this.erase(room);
        this.publish([guestSocket], 'call:end', { roomId: room.id, reason: 'peer-left' });
        return;
      }
      const ownerSocket = room.ownerSocketId;
      this.clearTimer(room, 'ring');
      room.callFrom = undefined;
      this.clearGuest(room);
      room.status = 'waiting';
      this.publish([ownerSocket], 'call:end', { roomId: room.id, reason: 'peer-left' });
    }, GRACE_MS);
    if (role === 'owner') room.ownerGrace = timer;
    else room.guestGrace = timer;
  }

  private clearGuest(room: Room): void {
    this.clearTimer(room, 'guest');
    this.clearTimer(room, 'hold');
    room.guest = undefined;
  }

  private armRing(room: Room): void {
    this.clearTimer(room, 'ring');
    room.ringTimer = setTimeout(() => {
      if (!this.rooms.has(room.id) || room.status !== 'ringing') return;
      const sockets = [room.ownerSocketId, room.guest?.socketId];
      room.status = 'waiting';
      room.callFrom = undefined;
      room.ringTimer = undefined;
      this.publish(sockets, 'call:reject', { roomId: room.id, by: 'timeout' });
    }, RING_MS);
  }

  private clearTimer(room: Room, kind: 'owner' | 'guest' | 'hold' | 'ring'): void {
    const key = kind === 'owner' ? 'ownerGrace' : kind === 'guest' ? 'guestGrace' : kind === 'hold' ? 'guestHold' : 'ringTimer';
    const timer = room[key];
    if (timer) clearTimeout(timer);
    room[key] = undefined;
  }

  private erase(room: Room): void {
    this.clearTimer(room, 'owner');
    this.clearTimer(room, 'guest');
    this.clearTimer(room, 'hold');
    this.clearTimer(room, 'ring');
    this.rooms.delete(room.id);
  }

  private expire(room: Room): void {
    const sockets = [room.ownerSocketId, room.guest?.socketId];
    this.erase(room);
    this.publish(sockets, 'call:end', { roomId: room.id, reason: 'expired' });
  }

  private sweep(): void {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      if (room.expiresAt <= now) this.expire(room);
    }
  }

  private publish(socketIds: Array<string | undefined>, event: string, payload: unknown): void {
    const ids = socketIds.filter((id): id is string => Boolean(id));
    if (ids.length === 0) return;
    this.listener?.(ids, event, payload);
  }
}
