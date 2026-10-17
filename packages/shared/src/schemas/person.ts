import { z } from 'zod';
import { SimDaySchema } from './common';

/** A synthetic employee of Apex Athletics. Mirrors the `Person` node. */
export const PersonSchema = z.object({
  name: z.string().min(1),
  dept: z.string().min(1),
  firstDay: SimDaySchema,
  // null while the person still works at the company.
  lastDay: SimDaySchema.nullable(),
  active: z.boolean(),
});

export type Person = z.infer<typeof PersonSchema>;

/** GET /people: everyone in the graph, for pickers. */
export const PersonListItemSchema = z.object({
  name: z.string(),
  dept: z.string().nullable(),
  active: z.boolean(),
  lastSeenDay: z.number().nullable(),
  departedDay: z.number().nullable(),
});
export type PersonListItem = z.infer<typeof PersonListItemSchema>;
