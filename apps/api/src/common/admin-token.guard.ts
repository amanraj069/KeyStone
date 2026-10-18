import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { Env } from '../config/env.schema';

/**
 * Protects endpoints that change data (e.g. POST /ingest/*, which deletes and
 * rebuilds a graph). If ADMIN_TOKEN is set, the request must send the header
 * `x-admin-token` with the same value. If ADMIN_TOKEN is empty (local dev), it allows all.
 */
@Injectable()
export class AdminTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get('ADMIN_TOKEN', { infer: true });
    if (!expected) return true;
    const sent = context.switchToHttp().getRequest<Request>().header('x-admin-token') ?? '';
    if (!safeEqual(sent, expected)) throw new UnauthorizedException('Missing or wrong x-admin-token');
    return true;
  }
}

/**
 * Stricter guard for /admin/* (restore replaces the whole graph): ADMIN_TOKEN must
 * be set AND sent. With no ADMIN_TOKEN configured these endpoints are disabled
 * (503), instead of open as in AdminTokenGuard's local-dev mode.
 */
@Injectable()
export class RequiredAdminTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get('ADMIN_TOKEN', { infer: true });
    if (!expected) throw new ServiceUnavailableException('ADMIN_TOKEN is not set, so /admin endpoints are disabled');
    const sent = context.switchToHttp().getRequest<Request>().header('x-admin-token') ?? '';
    if (!safeEqual(sent, expected)) throw new UnauthorizedException('Missing or wrong x-admin-token');
    return true;
  }
}

/** Constant-time comparison, so response timing does not leak the token. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
