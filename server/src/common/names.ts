import { BadRequestException } from '@nestjs/common';

export function cleanUsername(input: unknown): string {
  if (typeof input !== 'string') {
    throw new BadRequestException('用户名需要 3 到 20 位字母、数字或下划线');
  }
  const username = input.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    throw new BadRequestException('用户名需要 3 到 20 位字母、数字或下划线');
  }
  return username;
}

export function cleanPassword(input: unknown): string {
  if (typeof input !== 'string' || input.length < 8 || input.length > 72) {
    throw new BadRequestException('密码需要 8 到 72 个字符');
  }
  return input;
}

export function cleanDisplayName(input: unknown, label = '昵称'): string {
  if (typeof input !== 'string') {
    throw new BadRequestException(`请填写${label}`);
  }
  const name = input.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (name.length < 1 || name.length > 20) {
    throw new BadRequestException(`${label}需要 1 到 20 个字符`);
  }
  return name;
}
