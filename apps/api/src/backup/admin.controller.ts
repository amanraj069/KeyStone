import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequiredAdminTokenGuard } from '../common/admin-token.guard';
import { ActionsExportService, type ExportResult } from './actions-export.service';
import { MemoryExportService, type MemoryExportResult } from './memory-export.service';
import { type BackupResult, BackupService, type RestoreResult } from './backup.service';

const RestoreSchema = z.object({
  // Merge actions from actions-latest.jsonl back in after the copy (see BackupService.restore).
  reapplyActions: z.boolean().default(true),
});

/**
 * Operator endpoints. All of them need the header `x-admin-token: <ADMIN_TOKEN>`,
 * and they are disabled entirely when ADMIN_TOKEN is not set.
 *
 * POST /admin/backup          copy apex to apex_backup now
 * POST /admin/restore         replace apex with apex_backup  {reapplyActions?: boolean}
 * POST /admin/export-actions  write every Action to exports/actions-<timestamp>.jsonl and actions-latest.jsonl
 */
@Controller('admin')
@UseGuards(RequiredAdminTokenGuard)
export class AdminController {
  constructor(
    private readonly backup: BackupService,
    private readonly actionsExport: ActionsExportService,
    private readonly memoryExport: MemoryExportService,
  ) {}

  @Post('backup')
  @HttpCode(200)
  backupNow(): Promise<BackupResult> {
    return this.backup.backupNow();
  }

  @Post('restore')
  @HttpCode(200)
  restore(@Body() body: unknown): Promise<RestoreResult> {
    return this.backup.restore(RestoreSchema.parse(body ?? {}));
  }

  @Post('export-actions')
  @HttpCode(200)
  exportActions(): Promise<ExportResult> {
    return this.actionsExport.exportNow();
  }

  @Post('export-memory')
  @HttpCode(200)
  exportMemory(): Promise<MemoryExportResult> {
    return this.memoryExport.exportNow();
  }
}
