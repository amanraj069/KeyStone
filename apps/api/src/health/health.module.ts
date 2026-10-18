import { Module } from '@nestjs/common';
import { SeedModule } from '../seed/seed.module';
import { HealthController } from './health.controller';

@Module({ imports: [SeedModule], controllers: [HealthController] })
export class HealthModule {}
