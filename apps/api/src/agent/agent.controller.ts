import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AgentService } from './agent.service';

const AskSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  sessionId: z.string().trim().min(1).max(200).optional(),
});

/**
 * POST /agent/ask { question, sessionId? } -> Server-Sent Events, one JSON object per
 * event: classified, tool_call, tool_result, answer_delta, done (or error).
 */
@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Post('ask')
  async ask(@Body() body: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const { question, sessionId } = AskSchema.parse(body);
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    let closed = false;
    req.on('close', () => (closed = true));
    for await (const event of this.agent.run(question, sessionId ?? randomUUID())) {
      if (closed) break;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    res.end();
  }
}
