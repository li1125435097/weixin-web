export interface PublicUser {
  id: string;
  username: string;
  nickname: string;
  createdAt: string;
}

export interface RoomSummary {
  id: string;
  status: 'waiting' | 'ringing' | 'active';
  createdAt: number;
  expiresAt: number;
  guestName: string | null;
  invitePath: string;
  callFrom: 'owner' | 'guest' | null;
}

export interface RoomDetail {
  id: string;
  status: 'waiting' | 'ringing' | 'active';
  ownerNickname: string;
  expiresAt: number;
  joinable: boolean;
  viewer: 'owner' | 'guest' | 'none';
  guestName: string | null;
}
