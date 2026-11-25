import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

@Injectable()
export class RealtimeService {
  private server: Server | null = null;
  private readonly users = new Map<string, Set<string>>();
  private readonly owners = new Map<string, string>();

  bind(server: Server): void {
    this.server = server;
  }

  bindUser(userId: string, socketId: string): void {
    this.unbind(socketId);
    this.owners.set(socketId, userId);
    const sockets = this.users.get(userId) ?? new Set<string>();
    sockets.add(socketId);
    this.users.set(userId, sockets);
  }

  unbind(socketId: string): void {
    const userId = this.owners.get(socketId);
    if (!userId) return;
    this.owners.delete(socketId);
    const sockets = this.users.get(userId);
    sockets?.delete(socketId);
    if (sockets && sockets.size === 0) this.users.delete(userId);
  }

  userSockets(userId: string): string[] {
    return [...(this.users.get(userId) ?? [])];
  }

  to(socketId: string | undefined, event: string, payload: unknown): void {
    if (!socketId || !this.server) return;
    this.server.to(socketId).emit(event, payload);
  }

  toUser(userId: string, event: string, payload: unknown): void {
    for (const socketId of this.userSockets(userId)) this.to(socketId, event, payload);
  }

  disconnect(socketId: string | undefined): void {
    if (!socketId || !this.server) return;
    this.server.sockets.sockets.get(socketId)?.disconnect(true);
  }
}
