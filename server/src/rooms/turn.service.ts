import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

@Injectable()
export class TurnService {
  iceServers(identity: string): IceServer[] {
    const host = process.env.TURN_HOST?.trim();
    const secret = process.env.TURN_SECRET?.trim();
    if (!host || !secret) {
      return [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
    }
    const expiry = Math.floor(Date.now() / 1000) + 60 * 60;
    const username = `${expiry}:${identity}`;
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    return [
      { urls: `stun:${host}:3478` },
      {
        urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`],
        username,
        credential,
      },
    ];
  }
}
