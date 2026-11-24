export interface StoredMessage {
  id: string;
  sender: 'owner' | 'guest';
  senderName: string;
  type: 'text' | 'voice' | 'system';
  content: string;
  createdAt: number;
  durationMs?: number;
  mime?: string;
}

const LIMIT = 500;

function storageKey(roomId: string): string {
  return `webcall_messages_${roomId}`;
}

function isMessage(value: unknown): value is StoredMessage {
  if (!value || typeof value !== 'object') return false;
  const msg = value as Partial<StoredMessage>;
  if (typeof msg.id !== 'string' || typeof msg.content !== 'string' || typeof msg.createdAt !== 'number') return false;
  if (msg.sender !== 'owner' && msg.sender !== 'guest') return false;
  if (typeof msg.senderName !== 'string') return false;
  if (msg.type === 'text' || msg.type === 'system') return true;
  return msg.type === 'voice' && typeof msg.durationMs === 'number';
}

export function loadMessages(roomId: string): StoredMessage[] {
  try {
    const raw = localStorage.getItem(storageKey(roomId));
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(isMessage).slice(-LIMIT);
  } catch {
    return [];
  }
}

export function saveMessages(roomId: string, messages: StoredMessage[]): StoredMessage[] {
  const trimmed = messages.slice(-LIMIT);
  try {
    localStorage.setItem(storageKey(roomId), JSON.stringify(trimmed));
    return trimmed;
  } catch {
    const smaller = trimmed.slice(-30);
    try {
      localStorage.setItem(storageKey(roomId), JSON.stringify(smaller));
    } catch {
      return trimmed;
    }
    return smaller;
  }
}

export function remember(roomId: string, current: StoredMessage[], message: StoredMessage): StoredMessage[] {
  if (current.some((item) => item.id === message.id)) return current;
  const saved = saveMessages(roomId, [...current, message]);
  window.dispatchEvent(new CustomEvent('webcall-messages', { detail: roomId }));
  return saved;
}

export function lastMessage(roomId: string): StoredMessage | null {
  const all = loadMessages(roomId);
  return all[all.length - 1] ?? null;
}
