import { Body, Controller, Get, MessageEvent, Param, Post, Sse, UseGuards } from '@nestjs/common';
import { FullIngestRequestSchema, type IngestJob, ReplayRequestSchema } from '@keystone/shared';
import { map, type Observable } from 'rxjs';
import { AdminTokenGuard } from '../common/admin-token.guard';
import { IngestQueue } from './ingest.queue';

/**
 * POST /ingest/full     rebuild a graph (default apex) from artifacts.jsonl
 * POST /ingest/replay   rebuild a graph (default apex_replay) day by day
 * GET  /ingest/jobs/:id job state and latest progress
 * GET  /ingest/jobs/:id/events   Server-Sent Events: live progress until done
 * GET  /ingest/events            Server-Sent Events for every job (the web app's activity strip)
 * GET  /ingest/active            jobs running or waiting now (with their latest progress)
 * Bodies are validated with Zod; a bad body becomes a 400 ApiError.
 */
@Controller('ingest')
export class IngestController {
  constructor(private readonly queue: IngestQueue) {}

  @Post('full')
  @UseGuards(AdminTokenGuard)
  startFull(@Body() body: unknown): Promise<IngestJob> {
    return this.queue.addFull(FullIngestRequestSchema.parse(body ?? {}));
  }

  @Post('replay')
  @UseGuards(AdminTokenGuard)
  startReplay(@Body() body: unknown): Promise<IngestJob> {
    return this.queue.addReplay(ReplayRequestSchema.parse(body ?? {}));
  }

  @Sse('events')
  allEvents(): Observable<MessageEvent> {
    return this.queue.allEvents$().pipe(map((event) => ({ type: event.type, data: event })));
  }

  @Get('active')
  active(): Promise<IngestJob[]> {
    return this.queue.activeJobs();
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
