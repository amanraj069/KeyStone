import { Module } from '@nestjs/common';
import { APEX_GRAPH } from '../graph/graph.constants';
import { MEMORY_SETTINGS, type MemorySettings } from './memory.constants';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';

/** The agent's memory in the company graph: chats, feedback and approved notes (Stage 16). */
@Module({
  controllers: [MemoryController],
  providers: [{ provide: MEMORY_SETTINGS, useValue: { graph: APEX_GRAPH } satisfies MemorySettings }, MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
