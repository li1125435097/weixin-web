import { BadRequestException } from '@nestjs/common';
import { textUnits } from '../common/admin';
const VOICE_MIME = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/aac', 'audio/mpeg', 'audio/wav']);
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MEDIA_LIMIT = 1_000_000;

export const TEXT_PERSIST_UNITS = 2000;
const TEXT_SEND_UNITS = 100_000;

export interface ChatDraft {
  type: 'text' | 'voice' | 'image' | 'file';
  content: string;
  durationMs?: number;
  mime?: string;
  name?: string;
  persist: boolean;
}

export function normalizeChat(input: unknown): ChatDraft {
  if (!input || typeof input !== 'object') throw new BadRequestException('消息无效');
  const raw = input as { content?: unknown; type?: unknown; durationMs?: unknown; mime?: unknown; name?: unknown };
  if (raw.type === 'voice') return normalizeVoice(raw);
  if (raw.type === 'image') return normalizeImage(raw);
  if (raw.type === 'file') return normalizeFile(raw);
  if (typeof raw.content !== 'string') throw new BadRequestException('消息无效');
  const text = raw.content.replace(/\u0000/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!text) throw new BadRequestException('消息不能为空');
  const units = textUnits(text);
  if (units > TEXT_SEND_UNITS) throw new BadRequestException('消息太长');
  return { type: 'text', content: text, persist: units <= TEXT_PERSIST_UNITS };
}

function normalizeVoice(raw: { content?: unknown; durationMs?: unknown; mime?: unknown }): ChatDraft {
  if (typeof raw.content !== 'string') throw new BadRequestException('语音无效');
  const content = raw.content.replace(/\s/g, '');
  if (!content || content.length > 400_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) {
    throw new BadRequestException('语音太长');
  }
  if (typeof raw.durationMs !== 'number' || !Number.isInteger(raw.durationMs) || raw.durationMs < 300 || raw.durationMs > 60_000) {
    throw new BadRequestException('语音时长无效');
  }
  const mime = typeof raw.mime === 'string' ? raw.mime.split(';')[0].trim().toLowerCase() : '';
  if (!VOICE_MIME.has(mime)) throw new BadRequestException('语音格式不支持');
  return { type: 'voice', content, durationMs: raw.durationMs, mime, persist: true };
}

function normalizeImage(raw: { content?: unknown; mime?: unknown }): ChatDraft {
  const content = base64Content(raw.content, '图片无效');
  const mime = typeof raw.mime === 'string' ? raw.mime.split(';')[0].trim().toLowerCase() : '';
  if (!IMAGE_MIME.has(mime)) throw new BadRequestException('图片格式不支持');
  return { type: 'image', content, mime, persist: true };
}

function normalizeFile(raw: { content?: unknown; mime?: unknown; name?: unknown }): ChatDraft {
  const content = base64Content(raw.content, '文件无效');
  const mime = cleanMime(raw.mime);
  return { type: 'file', content, mime, name: cleanName(raw.name), persist: true };
}

function base64Content(value: unknown, invalid: string): string {
  if (typeof value !== 'string') throw new BadRequestException(invalid);
  const content = value.replace(/\s/g, '');
  if (!content || content.length > MEDIA_LIMIT || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) {
    throw new BadRequestException(invalid === '图片无效' ? '图片太大' : '文件太大');
  }
  return content;
}

function cleanMime(value: unknown): string {
  const fallback = 'application/octet-stream';
  if (typeof value !== 'string') return fallback;
  const mime = value.split(';')[0].trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(mime)) return fallback;
  if (mime === 'text/html' || mime === 'image/svg+xml') return fallback;
  return mime;
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '文件';
  const base = value.replace(/\\/g, '/').split('/').pop() || '';
  const cleaned = base.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
  return cleaned || '文件';
}
