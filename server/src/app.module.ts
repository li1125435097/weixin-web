import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { RoomsModule } from './rooms/rooms.module';
import { SignalingModule } from './signaling/signaling.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [UsersModule, AuthModule, RoomsModule, SignalingModule],
  controllers: [HealthController],
})
export class AppModule {}
