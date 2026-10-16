import { Module } from '@nestjs/common';
import { ProjectionService } from './projection.service';

/** Builds apex_proj (and as-of / benchmark projections). */
@Module({
  providers: [ProjectionService],
  exports: [ProjectionService],
})
export class ProjectionModule {}
