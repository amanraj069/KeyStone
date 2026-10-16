import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** data/calendar.json: the only place day numbers and dates are converted (AGENTS.md section 2). */
export interface Calendar {
  lastDay: number;
  dayByDate: ReadonlyMap<string, number>;
}

interface CalendarFile {
  lastDay: number;
  days: { day: number; date: string }[];
}

export const CALENDAR_FILE = 'calendar.json';

/** Reads DATA_DIR/calendar.json; null when it does not exist (tests with a bare data dir). */
export async function readCalendar(dataDir: string): Promise<Calendar | null> {
  try {
    const file = JSON.parse(await readFile(join(dataDir, CALENDAR_FILE), 'utf8')) as CalendarFile;
    return calendarFrom(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function calendarFrom(file: CalendarFile): Calendar {
  return { lastDay: file.lastDay, dayByDate: new Map(file.days.map((d) => [d.date, d.day])) };
}
