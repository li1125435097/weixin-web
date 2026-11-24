import type { PublicUser, RoomDetail, RoomSummary } from './types';

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

export const joinRoom = (roomId: string, nickname: string) =>
  api<{ roomId: string; nickname: string; ownerName: string }>('/api/rooms/join', {
    method: 'POST',
    body: JSON.stringify({ roomId, nickname }),
  });

export const fetchTurn = (roomId: string) =>
  api<{ iceServers: RTCIceServer[] }>(`/api/rooms/${roomId}/turn`);
