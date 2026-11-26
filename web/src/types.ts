export interface PublicUser {
  id: string;
  username: string;
  nickname: string;
  createdAt: string;
  kind: 'formal' | 'temp';
  displayName: string;
}

export interface ChatMessage {
  id: string;
  conversationId?: string;
  senderId: string;
  senderName: string;
  type: 'text' | 'voice' | 'system';
  content: string;
  createdAt: number;
  durationMs?: number;
  mime?: string;
  read?: boolean;
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
  roomId: string | null;
  roomStatus: 'waiting' | 'ringing' | 'active' | null;
  callFrom: 'owner' | 'guest' | null;
  role: 'owner' | 'guest' | null;
  invitePath: string | null;
}

export interface FriendCard {
  id: string;
  username: string;
  nickname: string;
  displayName: string;
  system: boolean;
}

export interface FriendLookup {
  id: string;
  username: string;
  nickname: string;
  displayName: string;
  relation: 'none' | 'friend' | 'outgoing' | 'incoming';
}

export interface FriendRequestCard {
  id: string;
  fromId: string;
  username: string;
  displayName: string;
  createdAt: number;
}

export interface RoomSummary {
  id: string;
  conversationId: string;
  status: 'waiting' | 'ringing' | 'active';
  createdAt: number;
  expiresAt: number;
  guestName: string | null;
  invitePath: string;
  callFrom: 'owner' | 'guest' | null;
}

export interface RoomDetail {
  id: string;
  conversationId: string;
  status: 'waiting' | 'ringing' | 'active';
  ownerNickname: string;
  expiresAt: number;
  joinable: boolean;
  viewer: 'owner' | 'guest' | 'none';
  guestName: string | null;
}
