import { BadRequestException } from '@nestjs/common';
import { newId } from '../common/ids';
import { MemberRole } from '../rooms/room.types';

const VOICE_MIME = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/aac', 'audio/mpeg', 'audio/wav']);

export interface OutgoingChat {
  id: string;
  sender: MemberRole;
  senderName: string;
  type: 'text' | 'voice';
  content: string;
  createdAt: number;
  durationMs?: number;
  mime?: string;
}

export function normalizeChat(input: unknown, sender: MemberRole, senderName: string): OutgoingChat {
  if (!input || typeof input !== 'object') throw new BadRequestException('消息无效');
  const raw = input as { content?: unknown; type?: unknown; durationMs?: unknown; mime?: unknown };
  if (raw.type === 'voice') return normalizeVoice(raw, sender, senderName);
  if (typeof raw.content !== 'string') throw new BadRequestException('消息无效');
  const text = raw.content.replace(/\u0000/g, '').trim();
  if (!text) throw new BadRequestException('消息不能为空');
  if (text.length > 2000) throw new BadRequestException('消息太长');
  return {
    id: newId('msg'),
    sender,
    senderName,
    type: 'text',
    content: text,
    createdAt: Date.now(),
  };
}

function normalizeVoice(
  raw: { content?: unknown; durationMs?: unknown; mime?: unknown },
  sender: MemberRole,
  senderName: string,
): OutgoingChat {
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
  return {
    id: newId('msg'),
    sender,
    senderName,
    type: 'voice',
    content,
    durationMs: raw.durationMs,
    mime,
    createdAt: Date.now(),
  };
}
