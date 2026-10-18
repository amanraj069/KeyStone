import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AskRequestSchema } from '@keystone/shared';
import { randomUUID } from 'node:crypto';
import { AgentRateLimitGuard } from '../common/rate-limit.guard';
import { AgentService } from './agent.service';

/**
 * POST /agent/ask { question, sessionId?, userId? } -> Server-Sent Events, one JSON
 * object per event: classified, memory, tool_call, tool_result, answer_delta, done
 * (with the stored turnId) or error.
 */
@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Post('ask')
  @UseGuards(AgentRateLimitGuard)
  async ask(@Body() body: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const { question, sessionId, userId } = AskRequestSchema.parse(body);
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    let closed = false;
    req.on('close', () => (closed = true));
    for await (const event of this.agent.run(question, sessionId ?? randomUUID(), { userId })) {
      if (closed) break;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    res.end();
  }
}
