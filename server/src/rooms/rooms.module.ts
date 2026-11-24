import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { RealtimeService } from './realtime.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { TurnService } from './turn.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [RoomsController],
  providers: [RoomsService, TurnService, RealtimeService],
  exports: [RoomsService, RealtimeService, TurnService],
})
export class RoomsModule {}
