import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

@Injectable()
export class RateLimitService {
  private readonly hits = new Map<string, number[]>();

  hit(key: string, limit = 8, windowMs = 60_000): void {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      throw new HttpException('尝试次数过多，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) {
      for (const [entry, stamps] of this.hits) {
        if (stamps.every((stamp) => now - stamp >= windowMs)) this.hits.delete(entry);
      }
    }
  }
}
