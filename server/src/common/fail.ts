import { HttpException } from '@nestjs/common';

export function errorMessage(error: unknown): string {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (typeof body === 'string') return body;
    if (typeof body === 'object' && body && 'message' in body) {
      const message = (body as { message: string | string[] }).message;
      return Array.isArray(message) ? message.join('，') : String(message);
    }
  }
  return '操作失败';
}
