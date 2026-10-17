import { Controller, Get, Param } from '@nestjs/common';
import type { ArtifactDetail } from '@keystone/shared';
import { z } from 'zod';
import { ArtifactsService } from './artifacts.service';

/** Artifact ids contain letters, digits and - _ . : T (Slack and Zoom ids carry timestamps). */
const ArtifactIdSchema = z.string().trim().min(1).max(200);

/** GET /artifacts/:id: title, type, day, people and a body excerpt (the UI's side sheet). */
@Controller('artifacts')
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  @Get(':id')
  detail(@Param('id') id: string): Promise<ArtifactDetail> {
    return this.artifacts.detail(ArtifactIdSchema.parse(id));
  }
}
