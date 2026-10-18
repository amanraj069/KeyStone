import { ServiceUnavailableException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { AdminTokenGuard, RequiredAdminTokenGuard } from './admin-token.guard';

function context(token?: string): ExecutionContext {
  const request = { header: (name: string) => (name === 'x-admin-token' ? token : undefined) };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function config(adminToken?: string): ConfigService<Env, true> {
  return { get: () => adminToken } as unknown as ConfigService<Env, true>;
}

describe('AdminTokenGuard', () => {
  it('allows everything when ADMIN_TOKEN is empty (local dev)', () => {
    expect(new AdminTokenGuard(config(undefined)).canActivate(context())).toBe(true);
  });
});

describe('RequiredAdminTokenGuard (/admin/*)', () => {
  it('is disabled (503) when ADMIN_TOKEN is not set', () => {
    expect(() => new RequiredAdminTokenGuard(config(undefined)).canActivate(context('anything'))).toThrow(ServiceUnavailableException);
  });

  it('rejects a missing or wrong token and accepts the right one', () => {
    const guard = new RequiredAdminTokenGuard(config('s3cret-token'));
    expect(() => guard.canActivate(context())).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context('wrong'))).toThrow(UnauthorizedException);
    expect(guard.canActivate(context('s3cret-token'))).toBe(true);
  });
});
