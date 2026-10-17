import { Module } from '@nestjs/common';
import { BenchController } from './bench.controller';

/**
 * Stage 13 benchmark. The API only serves the last results (GET /bench/results);
 * `pnpm bench` (scripts/bench.ts) runs DepartureBench and QaBench. src/bench/ is
 * the only code allowed to read the answer key (see answer-key.ts).
 */
@Module({ controllers: [BenchController] })
export class BenchModule {}
