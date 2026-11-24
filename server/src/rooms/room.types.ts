export type RoomStatus = 'waiting' | 'ringing' | 'active';
export type MemberRole = 'owner' | 'guest';

export interface GuestSeat {
  id: string;
  name: string;
  username?: string;
  socketId?: string;
}

export interface Room {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerUsername: string;
  status: RoomStatus;
  createdAt: number;
  expiresAt: number;
  callFrom?: MemberRole;
  guest?: GuestSeat;
  ownerSocketId?: string;
  ownerGrace?: NodeJS.Timeout;
  guestGrace?: NodeJS.Timeout;
  guestHold?: NodeJS.Timeout;
  ringTimer?: NodeJS.Timeout;
}

export interface Member {
  role: MemberRole;
  id: string;
  name: string;
  socketId: string;
}

export type RoomListener = (socketIds: string[], event: string, payload: unknown) => void;
