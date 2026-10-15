import { z } from 'zod';

/** A technical system or service (e.g. a payments API). Mirrors the `System` node. */
export const SystemSchema = z.object({
  name: z.string().min(1),
  // Other names the same system goes by in artifacts, used for entity matching.
  aliases: z.array(z.string()),
});

export type System = z.infer<typeof SystemSchema>;
