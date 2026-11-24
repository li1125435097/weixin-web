import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body() body: { username?: unknown; password?: unknown; nickname?: unknown }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.register(body, req.ip || 'unknown');
    this.auth.writeSession(res, user);
    return user;
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { username?: unknown; password?: unknown }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.login(body, req.ip || 'unknown');
    this.auth.writeSession(res, user);
    return user;
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    this.auth.clearSession(res);
    return { ok: true };
  }

  @Get('me')
  me(@Req() req: Request) {
    return this.auth.me(req);
  }
}
