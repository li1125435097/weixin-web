import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { DatabaseModule } from './db/database.module';
import { HealthController } from './health.controller';
import { RoomsModule } from './rooms/rooms.module';
import { SignalingModule } from './signaling/signaling.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [DatabaseModule, UsersModule, ChatModule, AuthModule, RoomsModule, SignalingModule],
  controllers: [HealthController],
})
export class AppModule {}
