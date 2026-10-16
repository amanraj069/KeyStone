import { Body, Controller, Get, MessageEvent, Param, Post, Sse, UseGuards } from '@nestjs/common';
import { type IngestJob, RefreshExpertiseRequestSchema } from '@keystone/shared';
import { map, type Observable } from 'rxjs';
import { AdminTokenGuard } from '../common/admin-token.guard';
import { IngestQueue } from '../ingest/ingest.queue';

/**
 * POST /analytics/refresh-expertise          K2 + K8a on apex, then rebuild apex_proj (BullMQ job)
 * GET  /analytics/jobs/:id/events            Server-Sent Events for that job
 * Lives in JobsModule because it needs the queue.
 */
@Controller('analytics')
export class RefreshController {
  constructor(private readonly queue: IngestQueue) {}

  @Post('refresh-expertise')
  @UseGuards(AdminTokenGuard)
  refresh(@Body() body: unknown): Promise<IngestJob> {
    return this.queue.addRefreshExpertise(RefreshExpertiseRequestSchema.parse(body ?? {}));
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
