import { forwardRef, Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { RoomsModule } from '../rooms/rooms.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RateLimitService } from './rate-limit.service';
import { TokenModule } from './token.module';

@Module({
  imports: [UsersModule, TokenModule, ChatModule, forwardRef(() => RoomsModule)],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, RateLimitService],
  exports: [AuthService, TokenModule],
})
export class AuthModule {}
