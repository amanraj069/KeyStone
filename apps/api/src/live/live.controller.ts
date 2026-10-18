import { Body, Controller, Get, HttpCode, HttpException, Post, Req, Res, UseGuards } from '@nestjs/common';
import { type LiveArtifact, type LiveEvent, LivePostSchema } from '@keystone/shared';
import type { Request, Response } from 'express';
import { AdminTokenGuard } from '../common/admin-token.guard';
import { LiveService } from './live.service';

/**
 * POST /live/artifacts {type, author, title?, channel?, text} -> Server-Sent Events:
 *   step (ingest, extract, embed, refresh, diff; start and done), then done {result} or error
 * GET  /live/artifacts  the live documents posted so far
 * POST /live/reset      removes them all and what they added
 * Posting and resetting change the company graph, so both need the admin token when one is set.
 */
@Controller('live')
export class LiveController {
  constructor(private readonly live: LiveService) {}

  @Post('artifacts')
  @UseGuards(AdminTokenGuard)
  async post(@Body() body: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    // Bad input and "busy" are plain HTTP errors, before the stream starts.
    const post = LivePostSchema.parse(body);
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    let closed = false;
    req.on('close', () => (closed = true));
    const send = (event: LiveEvent) => {
      if (!closed) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    try {
      send({ type: 'done', result: await this.live.post(post, send) });
    } catch (error) {
      const message = error instanceof HttpException || error instanceof Error ? error.message : String(error);
      send({ type: 'error', message });
    }
    res.end();
  }

  @Get('artifacts')
  list(): Promise<LiveArtifact[]> {
    return this.live.list();
  }

  @Post('reset')
  @HttpCode(200)
  @UseGuards(AdminTokenGuard)
  reset(): Promise<{ deleted: number; reactivated: number; departuresUndone: string[] }> {
    return this.live.reset();
  }
}
