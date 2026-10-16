import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ProjectionModule } from '../projection/projection.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ExpertiseService } from './expertise.service';
import { PeopleController } from './people.controller';
import { SystemsController } from './systems.controller';

/** Expertise (KNOWS, COLLAB), bus factor, bridges, departure impact, decisions, stale docs (Stage 7). */
@Module({
  imports: [ProjectionModule, CatalogModule],
  controllers: [AnalyticsController, SystemsController, PeopleController],
  providers: [AnalyticsService, ExpertiseService],
  exports: [AnalyticsService, ExpertiseService],
})
export class AnalyticsModule {}
