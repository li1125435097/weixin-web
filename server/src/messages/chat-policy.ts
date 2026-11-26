import { BadRequestException } from '@nestjs/common';
import { textUnits } from '../common/admin';
const VOICE_MIME = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/aac', 'audio/mpeg', 'audio/wav']);

export const TEXT_PERSIST_UNITS = 2000;
const TEXT_SEND_UNITS = 100_000;

export interface ChatDraft {
  type: 'text' | 'voice';
  content: string;
  durationMs?: number;
  mime?: string;
  persist: boolean;
}

export function normalizeChat(input: unknown): ChatDraft {
  if (!input || typeof input !== 'object') throw new BadRequestException('消息无效');
  const raw = input as { content?: unknown; type?: unknown; durationMs?: unknown; mime?: unknown };
  if (raw.type === 'voice') return normalizeVoice(raw);
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
