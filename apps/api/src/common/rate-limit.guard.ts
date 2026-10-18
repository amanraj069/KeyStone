import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../config/env.schema';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Sliding-window counters kept in memory: request times per key, oldest first.
 * One API process serves the agent, so no shared store is needed.
 */
export class SlidingWindow {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records a request for `key` at `now` if it is under the limit; false when it is not. */
  take(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((at) => at > now - this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** Seconds until the oldest request of `key` leaves the window (when a slot frees up). */
  retryAfterSeconds(key: string, now: number): number {
    const oldest = this.hits.get(key)?.[0] ?? now;
    return Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
  }
}

/**
 * Limits POST /agent/ask, the one public endpoint that spends LLM calls: at most
 * AGENT_RATE_PER_MINUTE questions a minute from one visitor, and AGENT_RATE_PER_HOUR
 * an hour from everyone together, so a busy day cannot drain the API key.
 * A request over a limit gets 429 with a message the Ask page shows.
 */
@Injectable()
export class AgentRateLimitGuard implements CanActivate {
  private readonly perVisitor: SlidingWindow;
  private readonly overall: SlidingWindow;

  constructor(config: ConfigService<Env, true>) {
    this.perVisitor = new SlidingWindow(config.get('AGENT_RATE_PER_MINUTE', { infer: true }), MINUTE_MS);
    this.overall = new SlidingWindow(config.get('AGENT_RATE_PER_HOUR', { infer: true }), HOUR_MS);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const visitor = request.ip ?? 'unknown';
    const now = Date.now();
    if (!this.perVisitor.take(visitor, now)) {
      const wait = this.perVisitor.retryAfterSeconds(visitor, now);
      throw new HttpException(`Too many questions at once. Try again in ${wait} s.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!this.overall.take('all', now)) {
      throw new HttpException('Keystone is answering a lot of questions right now. Try again in a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
