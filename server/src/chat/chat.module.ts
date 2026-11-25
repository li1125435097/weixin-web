import { Module } from '@nestjs/common';
import { TokenModule } from '../auth/token.module';
import { UsersModule } from '../users/users.module';
import { ChatService } from './chat.service';
import { FriendsController } from './friends.controller';
import { SessionService } from './session.service';

@Module({
  imports: [TokenModule, UsersModule],
  controllers: [FriendsController],
  providers: [ChatService, SessionService],
  exports: [ChatService, SessionService],
})
export class ChatModule {}
