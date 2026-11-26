import type { ChatMessage, ConversationSummary, FriendCard, FriendLookup, FriendRequestCard, PublicUser, RoomDetail, RoomSummary } from './types';

function withBase(path: string): string {
  const prefix = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${prefix}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(withBase(path), { ...init, headers, credentials: 'include' });
  const text = await response.text();
  let data: { message?: unknown } = {};
  if (text) {
    try {
      data = JSON.parse(text) as { message?: unknown };
    } catch {
      throw new Error('服务器返回了无法识别的内容');
    }
  }
  if (!response.ok) {
    throw new Error(typeof data.message === 'string' ? data.message : '请求失败');
  }
  return data as T;
}

export const me = () => api<PublicUser>('/api/auth/me');

export const becomeGuest = () => api<PublicUser>('/api/auth/guest', { method: 'POST' });

let pendingUser: Promise<PublicUser> | null = null;

export function ensureUser(): Promise<PublicUser> {
  if (!pendingUser) {
    pendingUser = (async () => {
      try {
        return await me();
      } catch {
        return becomeGuest();
      }
    })().finally(() => {
      pendingUser = null;
    });
  }
  return pendingUser;
}

export const login = (username: string, password: string) =>
  api<PublicUser>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });

export const register = (username: string, password: string, nickname: string) =>
  api<PublicUser>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, nickname }),
  });

export const logout = () => api<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });

export const createRoom = () => api<RoomSummary>('/api/rooms', { method: 'POST' });

export const listRooms = () => api<{ rooms: RoomSummary[] }>('/api/rooms');

export const roomDetail = (roomId: string) => api<RoomDetail>(`/api/rooms/${roomId}`);

export const joinRoom = (roomId: string, nickname?: string) =>
  api<{ roomId: string; conversationId: string; nickname: string; ownerName: string }>('/api/rooms/join', {
    method: 'POST',
    body: JSON.stringify({ roomId, nickname }),
  });

export const listConversations = () => api<{ conversations: ConversationSummary[] }>('/api/conversations');

export const listMessages = (conversationId: string) => api<{ messages: ChatMessage[] }>(`/api/conversations/${conversationId}/messages`);

export const clearMessages = (conversationId: string) =>
  api<{ ok: boolean }>(`/api/conversations/${conversationId}/messages`, { method: 'DELETE' });

export const openDirect = (userId: string) =>
  api<ConversationSummary>('/api/conversations/direct', { method: 'POST', body: JSON.stringify({ userId }) });

export const listFriends = () => api<{ friends: FriendCard[]; incoming: FriendRequestCard[] }>('/api/friends');

export const lookupFriend = (username: string) =>
  api<FriendLookup>(`/api/friends/lookup?username=${encodeURIComponent(username)}`);

export const requestFriend = (username: string) =>
  api<{ ok: boolean }>('/api/friends/requests', { method: 'POST', body: JSON.stringify({ username }) });

export const acceptFriend = (id: string) => api<{ ok: boolean }>(`/api/friends/requests/${id}/accept`, { method: 'POST' });

export const rejectFriend = (id: string) => api<{ ok: boolean }>(`/api/friends/requests/${id}/reject`, { method: 'POST' });

export const fetchTurn = (roomId: string) =>
  api<{ iceServers: RTCIceServer[] }>(`/api/rooms/${roomId}/turn`);
