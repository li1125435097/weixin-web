import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { displayNameOf, isAdminUsername, TEXT_QUOTA, textUnits, VOICE_QUOTA } from '../common/admin';
import { newId } from '../common/ids';
import { DatabaseService } from '../db/database.service';
import { ChatDraft } from '../messages/chat-policy';
import { StoredUser } from '../users/users.types';
import { UsersService } from '../users/users.service';

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  type: 'text' | 'voice';
  content: string;
  createdAt: number;
  durationMs?: number;
  mime?: string;
  read: boolean;
}

export interface ConversationSummary {
  id: string;
  kind: 'direct' | 'invite';
  createdBy: string;
  title: string;
  peerId: string | null;
  preview: string;
  updatedAt: number;
  unread: number;
}

export interface FriendCard {
  id: string;
  username: string;
  nickname: string;
  displayName: string;
  system: boolean;
}

export interface FriendRequestCard {
  id: string;
  fromId: string;
  username: string;
  displayName: string;
  createdAt: number;
}

export interface FriendLookup {
  id: string;
  username: string;
  nickname: string;
  displayName: string;
  relation: 'none' | 'friend' | 'outgoing' | 'incoming';
}

@Injectable()
export class ChatService {
  private readonly friendHits = new Map<string, number[]>();

  constructor(
    private readonly database: DatabaseService,
    private readonly users: UsersService,
  ) {}

  backfillAdmin(): void {
    const admin = this.users.findByUsername('lijinke');
    if (!admin) return;
    for (const id of this.users.listIds()) this.linkAdmin(id, admin.id);
  }

  ensureAdmin(userId: string): void {
    const admin = this.users.findByUsername('lijinke');
    if (!admin) return;
    this.linkAdmin(userId, admin.id);
  }

  openInvite(ownerId: string): string {
    const id = newId('c');
    const now = Date.now();
    this.database.tx(() => {
      this.database.run(
        `INSERT INTO conversations (id, kind, created_by, created_at, updated_at) VALUES (?, 'invite', ?, ?, ?)`,
        id,
        ownerId,
        now,
        now,
      );
      this.database.run(
        `INSERT INTO members (conversation_id, user_id, last_read_at, joined_at) VALUES (?, ?, 0, ?)`,
        id,
        ownerId,
        now,
      );
    });
    return id;
  }

  addMember(conversationId: string, userId: string): void {
    const now = Date.now();
    this.database.run(
      `INSERT OR IGNORE INTO members (conversation_id, user_id, last_read_at, joined_at) VALUES (?, ?, 0, ?)`,
      conversationId,
      userId,
      now,
    );
  }

  memberIds(conversationId: string): string[] {
    return this.database.all('SELECT user_id FROM members WHERE conversation_id = ?', conversationId).map((row) => String(row.user_id));
  }

  assertMember(conversationId: string, userId: string): void {
    const row = this.database.get('SELECT 1 AS ok FROM members WHERE conversation_id = ? AND user_id = ?', conversationId, userId);
    if (!row) throw new ForbiddenException('你不在这个聊天里');
  }

  list(userId: string): ConversationSummary[] {
    const rows = this.database.all(
      `SELECT c.id, c.kind, c.created_by, c.updated_at, m.last_read_at
       FROM conversations c
       JOIN members m ON m.conversation_id = c.id AND m.user_id = ?
       ORDER BY c.updated_at DESC`,
      userId,
    );
    return rows.map((row) => {
      const id = String(row.id);
      const peer = this.peer(id, userId);
      const last = this.database.get(
        `SELECT sender_id, type, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
        id,
      );
      const unread = this.database.get(
        `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_id != ? AND created_at > ?`,
        id,
        userId,
        Number(row.last_read_at) || 0,
      );
      return {
        id,
        kind: row.kind === 'direct' ? 'direct' : 'invite',
        createdBy: String(row.created_by),
        title: peer ? displayNameOf(peer) : '等待对方加入',
        peerId: peer?.id ?? null,
        preview: previewOf(last, Boolean(peer)),
        updatedAt: Number(row.updated_at),
        unread: Number(unread?.n || 0),
      };
    });
  }

  openDirect(userId: string, friendId: string): string {
    const self = this.requireFormal(userId);
    if (self.id === friendId) throw new BadRequestException('不能和自己聊天');
    if (!this.areFriends(userId, friendId)) throw new ForbiddenException('对方还不是好友');
    const existing = this.database.get(
      `SELECT c.id FROM conversations c
       JOIN members a ON a.conversation_id = c.id AND a.user_id = ?
       JOIN members b ON b.conversation_id = c.id AND b.user_id = ?
       WHERE c.kind = 'direct' LIMIT 1`,
      userId,
      friendId,
    );
    if (existing) return String(existing.id);
    const id = newId('c');
    const now = Date.now();
    this.database.tx(() => {
      this.database.run(
        `INSERT INTO conversations (id, kind, created_by, created_at, updated_at) VALUES (?, 'direct', ?, ?, ?)`,
        id,
        userId,
        now,
        now,
      );
      this.database.run(`INSERT INTO members (conversation_id, user_id, last_read_at, joined_at) VALUES (?, ?, 0, ?)`, id, userId, now);
      this.database.run(`INSERT INTO members (conversation_id, user_id, last_read_at, joined_at) VALUES (?, ?, 0, ?)`, id, friendId, now);
    });
    return id;
  }

  messages(conversationId: string, userId: string): { messages: ChatMessage[]; readAt: number; peerId: string | null } {
    this.assertMember(conversationId, userId);
    const readAt = Date.now();
    this.markRead(conversationId, userId, readAt);
    return { messages: this.loadMessages(conversationId, userId), readAt, peerId: this.peer(conversationId, userId)?.id ?? null };
  }

  markRead(conversationId: string, userId: string, readAt: number): void {
    this.database.run(
      `UPDATE members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ? AND last_read_at < ?`,
      readAt,
      conversationId,
      userId,
      readAt,
    );
  }

  send(conversationId: string, senderId: string, draft: ChatDraft): { message: ChatMessage; deletedIds: string[] } {
    this.assertMember(conversationId, senderId);
    if (!draft.persist) return { message: this.ephemeral(conversationId, senderId, draft), deletedIds: [] };
    const now = Date.now();
    const id = newId('msg');
    const deletedIds = this.database.tx(() => {
      this.database.run(
        `INSERT INTO messages (id, conversation_id, sender_id, type, content, created_at, duration_ms, mime)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        conversationId,
        senderId,
        draft.type,
        draft.content,
        now,
        draft.durationMs ?? null,
        draft.mime ?? null,
      );
      this.database.run('UPDATE conversations SET updated_at = ? WHERE id = ?', now, conversationId);
      return this.enforceQuota(senderId);
    });
    const message = this.loadMessages(conversationId, senderId).find((item) => item.id === id);
    if (!message) throw new NotFoundException('消息没有保存');
    return { message, deletedIds };
  }

  friends(userId: string): { friends: FriendCard[]; incoming: FriendRequestCard[] } {
    const rows = this.database.all(
      `SELECT u.id, u.username, u.nickname, f.system
       FROM friendships f JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = ? AND u.kind = 'formal'`,
      userId,
    );
    const friends = rows
      .map((row) => ({
        id: String(row.id),
        username: row.username ? String(row.username) : '',
        nickname: String(row.nickname || ''),
        displayName: displayNameOf({ username: row.username ? String(row.username) : null, nickname: String(row.nickname || '') }),
        system: isAdminUsername(row.username ? String(row.username) : null),
      }))
      .sort((a, b) => Number(b.system) - Number(a.system) || a.displayName.localeCompare(b.displayName, 'zh'));
    const incomingRows = this.database.all(
      `SELECT r.id, r.from_id, r.created_at, u.username, u.nickname
       FROM friend_requests r JOIN users u ON u.id = r.from_id
       WHERE r.to_id = ? AND r.status = 'pending'
       ORDER BY r.created_at DESC`,
      userId,
    );
    const incoming = incomingRows.map((row) => ({
      id: String(row.id),
      fromId: String(row.from_id),
      username: row.username ? String(row.username) : '',
      displayName: displayNameOf({ username: row.username ? String(row.username) : null, nickname: String(row.nickname || '') }),
      createdAt: Number(row.created_at),
    }));
    return { friends, incoming };
  }

  lookupUser(userId: string, username: string): FriendLookup {
    this.hitFriend(userId);
    const self = this.requireFormal(userId);
    if (self.username === username) throw new BadRequestException('不能添加自己');
    const target = this.users.findByUsername(username);
    if (!target || target.kind !== 'formal') throw new NotFoundException('没有这个用户');
    let relation: FriendLookup['relation'] = 'none';
    if (this.areFriends(userId, target.id)) relation = 'friend';
    else if (this.pendingRequest(userId, target.id)) relation = 'outgoing';
    else if (this.pendingRequest(target.id, userId)) relation = 'incoming';
    return {
      id: target.id,
      username: target.username || username,
      nickname: target.nickname,
      displayName: displayNameOf(target),
      relation,
    };
  }

  requestFriend(userId: string, username: string): void {
    this.hitFriend(userId);
    const self = this.requireFormal(userId);
    if (self.username === username) throw new BadRequestException('不能添加自己');
    if (isAdminUsername(username)) {
      this.ensureAdmin(userId);
      throw new ConflictException('已经是好友');
    }
    const target = this.users.findByUsername(username);
    if (!target || target.kind !== 'formal') throw new NotFoundException('没有这个用户');
    if (this.areFriends(userId, target.id)) throw new ConflictException('已经是好友');
    const reverse = this.pendingRequest(target.id, userId);
    if (reverse) {
      this.accept(userId, reverse);
      return;
    }
    if (this.pendingRequest(userId, target.id)) throw new ConflictException('申请已发送');
    this.database.run(
      `INSERT INTO friend_requests (id, from_id, to_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)`,
      newId('fr'),
      userId,
      target.id,
      Date.now(),
    );
  }

  accept(userId: string, requestId: string): void {
    this.requireFormal(userId);
    const row = this.database.get(`SELECT id, from_id, to_id, status FROM friend_requests WHERE id = ?`, requestId);
    if (!row || String(row.to_id) !== userId || row.status !== 'pending') throw new NotFoundException('申请不存在');
    const fromId = String(row.from_id);
    const now = Date.now();
    this.database.tx(() => {
      this.database.run(`UPDATE friend_requests SET status = 'accepted' WHERE id = ?`, requestId);
      this.database.run(
        `UPDATE friend_requests SET status = 'accepted' WHERE from_id = ? AND to_id = ? AND status = 'pending'`,
        userId,
        fromId,
      );
      this.linkPair(userId, fromId, 0, now);
    });
  }

  reject(userId: string, requestId: string): void {
    this.requireFormal(userId);
    const row = this.database.get(`SELECT to_id, status FROM friend_requests WHERE id = ?`, requestId);
    if (!row || String(row.to_id) !== userId || row.status !== 'pending') throw new NotFoundException('申请不存在');
    this.database.run(`UPDATE friend_requests SET status = 'rejected' WHERE id = ?`, requestId);
  }

  mergeTemp(tempId: string, formalId: string): void {
    this.database.tx(() => {
      this.database.run('UPDATE messages SET sender_id = ? WHERE sender_id = ?', formalId, tempId);
      const memberships = this.database.all('SELECT conversation_id FROM members WHERE user_id = ?', tempId);
      for (const membership of memberships) {
        const conversationId = String(membership.conversation_id);
        const exists = this.database.get('SELECT 1 AS ok FROM members WHERE conversation_id = ? AND user_id = ?', conversationId, formalId);
        if (exists) this.database.run('DELETE FROM members WHERE conversation_id = ? AND user_id = ?', conversationId, tempId);
        else this.database.run('UPDATE members SET user_id = ? WHERE conversation_id = ? AND user_id = ?', formalId, conversationId, tempId);
      }
      this.database.run('DELETE FROM friendships WHERE user_id = ? OR friend_id = ?', tempId, tempId);
      this.database.run('DELETE FROM friend_requests WHERE from_id = ? OR to_id = ?', tempId, tempId);
    });
    this.database.tx(() => {
      this.enforceQuota(formalId);
    });
  }

  purgeUser(userId: string): void {
    this.database.tx(() => {
      this.database.run('DELETE FROM messages WHERE sender_id = ?', userId);
      this.database.run('DELETE FROM members WHERE user_id = ?', userId);
      this.database.run('DELETE FROM friendships WHERE user_id = ? OR friend_id = ?', userId, userId);
      this.database.run('DELETE FROM friend_requests WHERE from_id = ? OR to_id = ?', userId, userId);
      this.database.run('DELETE FROM users WHERE id = ?', userId);
      this.database.run(
        `DELETE FROM conversations WHERE id NOT IN (SELECT conversation_id FROM members)`,
      );
    });
  }

  sweepTemps(): string[] {
    const ids = this.users.expiredTempIds();
    for (const id of ids) this.purgeUser(id);
    return ids;
  }

  isAbandonedInvite(conversationId: string): boolean {
    const conversation = this.database.get(`SELECT kind FROM conversations WHERE id = ?`, conversationId);
    if (!conversation || conversation.kind !== 'invite') return false;
    const members = this.database.get(`SELECT COUNT(*) AS n FROM members WHERE conversation_id = ?`, conversationId);
    const messages = this.database.get(`SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?`, conversationId);
    return Number(members?.n || 0) < 2 && Number(messages?.n || 0) === 0;
  }

  deleteConversation(conversationId: string): void {
    this.database.tx(() => {
      this.database.run('DELETE FROM messages WHERE conversation_id = ?', conversationId);
      this.database.run('DELETE FROM members WHERE conversation_id = ?', conversationId);
      this.database.run('DELETE FROM conversations WHERE id = ?', conversationId);
    });
  }

  clearMessages(conversationId: string, userId: string): void {
    this.assertMember(conversationId, userId);
    this.database.run('DELETE FROM messages WHERE conversation_id = ?', conversationId);
  }

  private ephemeral(conversationId: string, senderId: string, draft: ChatDraft): ChatMessage {
    const sender = this.users.findStored(senderId);
    return {
      id: newId('msg'),
      conversationId,
      senderId,
      senderName: sender ? displayNameOf(sender) : '对方',
      type: 'text',
      content: draft.content,
      createdAt: Date.now(),
      read: false,
    };
  }

  private loadMessages(conversationId: string, userId: string): ChatMessage[] {
    const peerRead = this.peerReadAt(conversationId, userId);
    const rows = this.database.all(
      `SELECT id, conversation_id, sender_id, type, content, created_at, duration_ms, mime
       FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC`,
      conversationId,
    );
    return rows.map((row) => {
      const senderId = String(row.sender_id);
      const sender = this.users.findStored(senderId);
      const message: ChatMessage = {
        id: String(row.id),
        conversationId,
        senderId,
        senderName: sender ? displayNameOf(sender) : '对方',
        type: row.type === 'voice' ? 'voice' : 'text',
        content: String(row.content),
        createdAt: Number(row.created_at),
        read: senderId === userId && peerRead >= Number(row.created_at),
      };
      if (row.duration_ms != null) message.durationMs = Number(row.duration_ms);
      if (row.mime != null) message.mime = String(row.mime);
      return message;
    });
  }

  private peer(conversationId: string, userId: string): StoredUser | null {
    const row = this.database.get('SELECT user_id FROM members WHERE conversation_id = ? AND user_id != ? LIMIT 1', conversationId, userId);
    if (!row) return null;
    return this.users.findStored(String(row.user_id));
  }

  private peerReadAt(conversationId: string, userId: string): number {
    const row = this.database.get(
      'SELECT last_read_at FROM members WHERE conversation_id = ? AND user_id != ? LIMIT 1',
      conversationId,
      userId,
    );
    return row ? Number(row.last_read_at) : 0;
  }

  private pendingRequest(fromId: string, toId: string): string | null {
    const row = this.database.get(
      `SELECT id FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'`,
      fromId,
      toId,
    );
    return row ? String(row.id) : null;
  }

  private areFriends(left: string, right: string): boolean {
    const row = this.database.get('SELECT 1 AS ok FROM friendships WHERE user_id = ? AND friend_id = ?', left, right);
    return Boolean(row);
  }

  private requireFormal(userId: string): StoredUser {
    const user = this.users.findStored(userId);
    if (!user || user.kind !== 'formal') throw new ForbiddenException('请先登录');
    return user;
  }

  private linkAdmin(userId: string, adminId: string): void {
    if (!adminId || userId === adminId) return;
    this.linkPair(userId, adminId, 1, Date.now());
  }

  private linkPair(left: string, right: string, system: number, now: number): void {
    this.database.run(
      `INSERT OR IGNORE INTO friendships (user_id, friend_id, system, created_at) VALUES (?, ?, ?, ?)`,
      left,
      right,
      system,
      now,
    );
    this.database.run(
      `INSERT OR IGNORE INTO friendships (user_id, friend_id, system, created_at) VALUES (?, ?, ?, ?)`,
      right,
      left,
      system,
      now,
    );
  }

  private enforceQuota(senderId: string): string[] {
    const user = this.users.findStored(senderId);
    if (!user || isAdminUsername(user.username)) return [];
    const deleted: string[] = [];
    const texts = this.database.all(
      `SELECT id, content FROM messages WHERE sender_id = ? AND type = 'text' ORDER BY created_at ASC, id ASC`,
      senderId,
    );
    let used = 0;
    const keep = new Set<string>();
    for (let index = texts.length - 1; index >= 0; index -= 1) {
      const units = textUnits(String(texts[index].content));
      if (used + units > TEXT_QUOTA) break;
      used += units;
      keep.add(String(texts[index].id));
    }
    for (const row of texts) {
      const id = String(row.id);
      if (keep.has(id)) continue;
      this.database.run('DELETE FROM messages WHERE id = ?', id);
      deleted.push(id);
    }
    const voices = this.database.all(
      `SELECT id FROM messages WHERE sender_id = ? AND type = 'voice' ORDER BY created_at ASC, id ASC`,
      senderId,
    );
    const extra = voices.length - VOICE_QUOTA;
    for (let index = 0; index < extra; index += 1) {
      const id = String(voices[index].id);
      this.database.run('DELETE FROM messages WHERE id = ?', id);
      deleted.push(id);
    }
    return deleted;
  }

  private hitFriend(userId: string): void {
    const now = Date.now();
    const recent = (this.friendHits.get(userId) ?? []).filter((stamp) => now - stamp < 60_000);
    if (recent.length >= 8) throw new BadRequestException('尝试次数过多，请稍后再试');
    recent.push(now);
    this.friendHits.set(userId, recent);
  }
}

function previewOf(last: Record<string, unknown> | undefined, hasPeer: boolean): string {
  if (!last) return hasPeer ? '点击开始聊天' : '邀请对方加入';
  if (last.type === 'voice') return '[语音]';
  return String(last.content || '').replace(/[\r\n]+/g, ' ');
}
