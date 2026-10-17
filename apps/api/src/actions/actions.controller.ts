import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { GraphView } from '@keystone/shared';
import { z } from 'zod';
import { AdminTokenGuard } from '../common/admin-token.guard';
import { ACTION_STATUSES } from './actions.constants';
import { type ActionRow, ActionsService, type HandoverPlan } from './actions.service';

const ListQuerySchema = z.object({ status: z.enum(ACTION_STATUSES).optional() });
const IdSchema = z.string().trim().regex(/^act-[0-9a-f]{12}$/, 'not an action id');
const RejectSchema = z.object({ reason: z.string().trim().min(1).max(1000) });
const HandoverSchema = z.object({ person: z.string().trim().min(1).max(200) });

/**
 * GET  /actions?status=            proposals and decisions, newest first
 * GET  /actions/:id/why            the audit trail of one action
 * GET  /actions/:id/graph          the same trail as a graph to draw ({nodes, edges})
 * POST /actions/handover {person}  draft a handover plan (proposals only)
 * POST /actions/:id/approve        a person approves (admin token); a reassignment moves the ticket
 * POST /actions/:id/reject {reason}
 * Approve and reject exist only here, for people: no MCP tool can call them.
 */
@Controller('actions')
export class ActionsController {
  constructor(private readonly actions: ActionsService) {}

  @Get()
  list(@Query() query: unknown): Promise<ActionRow[]> {
    return this.actions.list(ListQuerySchema.parse(query).status ?? null);
  }

  @Get(':id/why')
  why(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.actions.why(IdSchema.parse(id));
  }

  @Get(':id/graph')
  graph(@Param('id') id: string): Promise<GraphView> {
    return this.actions.graphOf(IdSchema.parse(id));
  }

  @Post('handover')
  handover(@Body() body: unknown): Promise<HandoverPlan> {
    return this.actions.draftHandover(HandoverSchema.parse(body).person);
  }

  @Post(':id/approve')
  @UseGuards(AdminTokenGuard)
  approve(@Param('id') id: string): Promise<ActionRow & { moved: number }> {
    return this.actions.approve(IdSchema.parse(id));
  }

  @Post(':id/reject')
  @UseGuards(AdminTokenGuard)
  reject(@Param('id') id: string, @Body() body: unknown): Promise<ActionRow> {
    return this.actions.reject(IdSchema.parse(id), RejectSchema.parse(body).reason);
  }
}
