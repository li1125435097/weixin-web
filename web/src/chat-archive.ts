import type { ChatMessage } from './types';

function storageKey(userId: string, conversationId: string): string {
  return `wx-chat:${userId}:${conversationId}`;
}

function cutoffKey(userId: string, conversationId: string): string {
  return `wx-chat-cut:${userId}:${conversationId}`;
}

const STORED_TYPES = new Set(['text', 'voice', 'image', 'file']);

function isStoredMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const row = value as ChatMessage;
  return (
    typeof row.id === 'string' &&
    typeof row.senderId === 'string' &&
    typeof row.content === 'string' &&
    STORED_TYPES.has(row.type) &&
    typeof row.createdAt === 'number'
  );
}

export function localCutoff(userId: string, conversationId: string): number {
  if (!userId) return 0;
  const value = Number(localStorage.getItem(cutoffKey(userId, conversationId)) || 0);
  return Number.isFinite(value) ? value : 0;
}

export function setLocalCutoff(userId: string, conversationId: string, at: number): void {
  if (!userId) return;
  try {
    localStorage.setItem(cutoffKey(userId, conversationId), String(at));
  } catch {
    /* 本地空间不足时放弃写入 */
  }
}

export function clearLocalCutoff(userId: string, conversationId: string): void {
  if (!userId) return;
  try {
    localStorage.removeItem(cutoffKey(userId, conversationId));
  } catch {
    /* 忽略无法访问的本地存储 */
  }
}

export function clearArchive(userId: string, conversationId: string): void {
  if (!userId) return;
  try {
    localStorage.removeItem(storageKey(userId, conversationId));
  } catch {
    /* 忽略无法访问的本地存储 */
  }
}

export function loadArchive(userId: string, conversationId: string): ChatMessage[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId, conversationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredMessage);
  } catch {
    return [];
  }
}

export function saveArchive(userId: string, conversationId: string, messages: ChatMessage[]): void {
  if (!userId) return;
  const storage = storageKey(userId, conversationId);
  let rows = messages.filter((item) => STORED_TYPES.has(item.type));
  while (rows.length > 0) {
    try {
      localStorage.setItem(storage, JSON.stringify(rows));
      return;
    } catch {
      if (rows.length === 1) {
        try {
          localStorage.removeItem(storage);
        } catch {
          /* 本地空间不足时放弃写入 */
        }
        return;
      }
      rows = rows.slice(Math.max(1, Math.floor(rows.length / 2)));
    }
  }
}

export function mergeArchives(server: ChatMessage[], local: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const item of local) {
    if (item.type === 'system') continue;
    map.set(item.id, item);
  }
  for (const item of server) {
    const prev = map.get(item.id);
    map.set(item.id, prev ? { ...prev, ...item } : item);
  }
  return [...map.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
