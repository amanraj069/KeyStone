import { Body, Controller, Get, MessageEvent, Param, Post, Sse, UseGuards } from '@nestjs/common';
import { ExtractRequestSchema, type IngestJob } from '@keystone/shared';
import { map, type Observable } from 'rxjs';
import { AdminTokenGuard } from '../common/admin-token.guard';
import { IngestQueue } from '../ingest/ingest.queue';

/**
 * POST /extract/run              start LLM extraction as a BullMQ job (body: ExtractRequest)
 * GET  /extract/jobs/:id         job state and latest progress
 * GET  /extract/jobs/:id/events  Server-Sent Events: live progress until done
 * The job shares the ingest queue, so it never runs at the same time as an ingest.
 */
@Controller('extract')
export class ExtractController {
  constructor(private readonly queue: IngestQueue) {}

  @Post('run')
  @UseGuards(AdminTokenGuard)
  run(@Body() body: unknown): Promise<IngestJob> {
    return this.queue.addExtract(ExtractRequestSchema.parse(body ?? {}));
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string): Promise<IngestJob> {
    return this.queue.getJob(id);
  }

  @Sse('jobs/:id/events')
  events(@Param('id') id: string): Observable<MessageEvent> {
    return this.queue.events$(id).pipe(map((event) => ({ type: event.type, data: event })));
  }
}
