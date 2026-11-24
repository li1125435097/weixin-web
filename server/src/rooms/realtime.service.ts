import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

@Injectable()
export class RealtimeService {
  private server: Server | null = null;

  bind(server: Server): void {
    this.server = server;
  }

  to(socketId: string | undefined, event: string, payload: unknown): void {
    if (!socketId || !this.server) return;
    this.server.to(socketId).emit(event, payload);
  }

  disconnect(socketId: string | undefined): void {
    if (!socketId || !this.server) return;
    this.server.sockets.sockets.get(socketId)?.disconnect(true);
  }
}
