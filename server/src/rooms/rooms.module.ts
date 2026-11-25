import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { UsersModule } from '../users/users.module';
import { ConversationsController } from './conversations.controller';
import { MaintenanceService } from './maintenance.service';
import { RealtimeService } from './realtime.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { TurnService } from './turn.service';

@Module({
  imports: [ChatModule, UsersModule, forwardRef(() => AuthModule)],
  controllers: [RoomsController, ConversationsController],
  providers: [RoomsService, TurnService, RealtimeService, MaintenanceService],
  exports: [RoomsService, RealtimeService, TurnService],
})
export class RoomsModule {}