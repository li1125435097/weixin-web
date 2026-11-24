import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RoomsModule } from '../rooms/rooms.module';
import { SignalingGateway } from './signaling.gateway';

@Module({
  imports: [RoomsModule, AuthModule],
  providers: [SignalingGateway],
})
export class SignalingModule {}
