import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BenchResults } from '@keystone/shared';
import type { Env } from '../config/env.schema';
import { readResults } from './results-store';

/** GET /bench/results: the published run (apps/api/bench-results/results.json, tracked by git), else data/bench/results.json. Running it stays a CLI job. */
@Controller('bench')
export class BenchController {
  constructor(private readonly config: ConfigService<Env, true>) {}

  @Get('results')
  async results(): Promise<BenchResults> {
    const results = await readResults(this.config.get('DATA_DIR', { infer: true }));
    if (!results) throw new NotFoundException('No benchmark results yet; run `pnpm bench`');
    return results;
  }
}
