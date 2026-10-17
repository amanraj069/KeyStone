import { Module } from '@nestjs/common';
import { ArtifactsController } from './artifacts.controller';
import { ArtifactsService } from './artifacts.service';

/** Reading artifacts: single artifacts for the UI, and the agent's event tools (via MCP). */
@Module({ controllers: [ArtifactsController], providers: [ArtifactsService], exports: [ArtifactsService] })
export class ArtifactsModule {}
