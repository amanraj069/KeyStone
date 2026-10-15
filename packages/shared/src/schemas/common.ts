import { z } from 'zod';

/**
 * OrgForge measures time in simulation days (day 1, day 2, ...),
 * not calendar dates. Every `day` property in the graph uses this.
 */
export const SimDaySchema = z.number().int().nonnegative();
