import { Module } from '@nestjs/common';
import { TokenModule } from '../auth/token.module';
import { ChatModule } from '../chat/chat.module';
import { RoomsModule } from '../rooms/rooms.module';
import { UsersModule } from '../users/users.module';
import { SignalingGateway } from './signaling.gateway';

@Module({
  imports: [RoomsModule, TokenModule, ChatModule, UsersModule],
  providers: [SignalingGateway],
})
export class SignalingModule {}
