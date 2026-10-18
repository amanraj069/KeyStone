import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { FeedbackRequestSchema, type FeedbackResponse, type Note, NOTE_STATUSES, type Recall, type SessionSummary } from '@keystone/shared';
import { z } from 'zod';
import { AdminTokenGuard } from '../common/admin-token.guard';
import { MemoryService } from './memory.service';

const TurnIdSchema = z.string().trim().regex(/^turn-[0-9a-f-]{36}$/, 'not a turn id');
const NoteIdSchema = z.string().trim().regex(/^NOTE-[0-9a-f]{8}$/, 'not a note id');
const ListNotesSchema = z.object({ status: z.enum(NOTE_STATUSES).optional() });
const SessionsSchema = z.object({ userId: z.string().trim().min(1).max(200) });
const AboutSchema = z.object({ name: z.union([z.string().trim().min(1).max(200), z.array(z.string().trim().min(1).max(200)).max(5)]) });
const RejectSchema = z.object({ reason: z.string().trim().min(1).max(1000) });

/**
 * POST /memory/turns/:id/feedback {rating, correction?}  thumbs up/down; a correction becomes a proposed Note
 * GET  /memory/notes?status=                             notes for review, newest first
 * POST /memory/notes/:id/approve                         a person approves (admin token): the agent starts using it
 * POST /memory/notes/:id/reject {reason}
 * GET  /memory/sessions?userId=                          a user's chats
 * GET  /memory/about?name=                               what Keystone remembers about a system or person
 * Approve and reject exist only here, for people: no MCP tool can call them.
 */
@Controller('memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  @Post('turns/:id/feedback')
  feedback(@Param('id') id: string, @Body() body: unknown): Promise<FeedbackResponse> {
    return this.memory.feedback(TurnIdSchema.parse(id), FeedbackRequestSchema.parse(body));
  }

  @Get('notes')
  notes(@Query() query: unknown): Promise<Note[]> {
    return this.memory.notes(ListNotesSchema.parse(query).status ?? null);
  }

  @Post('notes/:id/approve')
  @UseGuards(AdminTokenGuard)
  approve(@Param('id') id: string): Promise<Note> {
    return this.memory.review(NoteIdSchema.parse(id), 'approved');
  }

  @Post('notes/:id/reject')
  @UseGuards(AdminTokenGuard)
  reject(@Param('id') id: string, @Body() body: unknown): Promise<Note> {
    return this.memory.review(NoteIdSchema.parse(id), 'rejected', RejectSchema.parse(body).reason);
  }

  @Get('sessions')
  sessions(@Query() query: unknown): Promise<SessionSummary[]> {
    return this.memory.sessions(SessionsSchema.parse(query).userId);
  }

  @Get('about')
  about(@Query() query: unknown): Promise<Recall[]> {
    const { name } = AboutSchema.parse(query);
    return this.memory.recall(Array.isArray(name) ? name : [name]);
  }
}
