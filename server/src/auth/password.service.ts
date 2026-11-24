import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | null = null;

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, 12);
  }

  async verify(plain: string, passwordHash: string | undefined): Promise<boolean> {
    const hash = passwordHash ?? (await this.placeholder());
    const matches = await bcrypt.compare(plain, hash);
    return Boolean(passwordHash) && matches;
  }

  private placeholder(): Promise<string> {
    this.dummyHash ??= bcrypt.hash('webcall-not-a-user', 12);
    return this.dummyHash;
  }
}
