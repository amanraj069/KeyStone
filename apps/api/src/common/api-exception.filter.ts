import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ApiError } from '@keystone/shared';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

/**
 * Turns every thrown error into the shared ApiError shape, so the web app only
 * has to handle one error format.
 * - HttpException (NotFoundException, ...) keeps its status and message.
 * - ZodError (bad input or a bad LLM output) becomes 400 VALIDATION_FAILED.
 * - Anything else becomes a generic 500; details go to the log, not the client.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const body = this.toApiError(exception, request.url);
    if (body.statusCode >= 500) {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`${request.method} ${request.url} failed`, stack);
    }
    response.status(body.statusCode).json(body);
  }

  toApiError(exception: unknown, path: string): ApiError {
    const timestamp = new Date().toISOString();

    if (exception instanceof ZodError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: exception.issues,
        path,
        timestamp,
      };
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      return {
        statusCode,
        error: statusCodeName(statusCode),
        message: messageOf(exception),
        path,
        timestamp,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'INTERNAL_ERROR',
      message: 'Something went wrong. Check the API logs.',
      path,
      timestamp,
    };
  }
}

/** 404 -> "NOT_FOUND", 503 -> "SERVICE_UNAVAILABLE", unknown -> "HTTP_<code>". */
function statusCodeName(statusCode: number): string {
  const name = (HttpStatus as unknown as Record<number, string | undefined>)[statusCode];
  return name ?? `HTTP_${statusCode}`;
}

/** Nest exceptions carry either a string or { message: string | string[] }. */
function messageOf(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' ? message : exception.message;
}
