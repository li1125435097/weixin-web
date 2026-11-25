import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChatService } from '../chat/chat.service';
import { RoomsService } from './rooms.service';

@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly chat: ChatService,
    private readonly rooms: RoomsService,
  ) {}

  onModuleInit(): void {
    this.chat.backfillAdmin();
    this.sweep();
    this.timer = setInterval(() => this.sweep(), 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private sweep(): void {
    for (const id of this.chat.sweepTemps()) this.rooms.dropUser(id);
  }
}
