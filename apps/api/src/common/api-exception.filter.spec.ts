import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ApiErrorSchema } from '@keystone/shared';
import { z } from 'zod';
import { ApiExceptionFilter } from './api-exception.filter';

describe('ApiExceptionFilter.toApiError', () => {
  const filter = new ApiExceptionFilter();

  it('maps HttpException to its status and a readable code', () => {
    const body = filter.toApiError(new NotFoundException('No such person'), '/people/x');
    expect(body).toMatchObject({ statusCode: 404, error: 'NOT_FOUND', message: 'No such person', path: '/people/x' });
    expect(ApiErrorSchema.safeParse(body).success).toBe(true);
  });

  it('maps ZodError to 400 VALIDATION_FAILED with issues', () => {
    const zodError = z.object({ name: z.string() }).safeParse({}).error!;
    const body = filter.toApiError(zodError, '/ask');
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('VALIDATION_FAILED');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('hides internal error messages from clients', () => {
    const body = filter.toApiError(new Error('password=hunter2 leaked'), '/x');
    expect(body.statusCode).toBe(500);
    expect(body.message).not.toContain('hunter2');
  });

  it('keeps 503 for a disconnected database', () => {
    const body = filter.toApiError(new ServiceUnavailableException('FalkorDB is not connected yet'), '/x');
    expect(body.error).toBe('SERVICE_UNAVAILABLE');
  });
});
