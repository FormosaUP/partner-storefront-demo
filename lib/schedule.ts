// Scheduled pickup times.
//
// The API speaks in the store's local wall-clock time with no offset ("2026-10-03T10:00:00"), both in
// `schedulableWindows` and in `scheduledTime`. Nothing here converts between time zones: a wall-clock string is
// parsed as if it were UTC purely to get a number that can be compared, stepped and formatted back.
// The store's time zone is used for one thing only: knowing what "now" and "today" are at the store.

export interface ScheduleWindow {
  start: string;
  end: string;
}

export interface ScheduleSlot {
  value: string;
  label: string;
}

export interface ScheduleDay {
  key: string;
  label: string;
  slots: ScheduleSlot[];
}

const SLOT_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const toMs = (wall: string) => Date.parse(`${wall.slice(0, 19)}Z`);
const toWall = (ms: number) => new Date(ms).toISOString().slice(0, 19);

export const isWallClock = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value);

// The present moment as the store's wall clock reads it.
export function storeNow(timezone: string | null | undefined, epochMs = Date.now()): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(epochMs));
  } catch {
    return epochMs;
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return toMs(`${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}`);
}

const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
const weekdayFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

function dayLabel(dayMs: number, todayMs: number) {
  const diff = Math.round((dayMs - todayMs) / DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return weekdayFormat.format(new Date(dayMs));
}

// Turns the store's schedulable windows into half-hour pickup times, grouped by day.
// Times sit on the :00 / :30 grid so the list stays the same between refreshes, although the API accepts any minute inside a window.
export function buildDays(windows: ScheduleWindow[] | null | undefined, timezone: string | null | undefined, epochMs = Date.now()): ScheduleDay[] {
  if (!windows?.length) return [];
  const now = storeNow(timezone, epochMs);
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const days = new Map<number, ScheduleDay>();
  for (const w of windows) {
    const start = toMs(w.start);
    const end = toMs(w.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    // The windows may be a few minutes old, so never offer a time the store's clock has already passed.
    const first = Math.ceil(Math.max(start, now + 1) / SLOT_MS) * SLOT_MS;
    for (let t = first; t <= end; t += SLOT_MS) {
      const dayMs = Math.floor(t / DAY_MS) * DAY_MS;
      let day = days.get(dayMs);
      if (!day) {
        day = { key: toWall(dayMs).slice(0, 10), label: dayLabel(dayMs, today), slots: [] };
        days.set(dayMs, day);
      }
      day.slots.push({ value: toWall(t), label: timeFormat.format(new Date(t)) });
    }
  }
  return [...days.entries()].sort((a, b) => a[0] - b[0]).map(([, day]) => day);
}

export const hasSlot = (days: ScheduleDay[], value: string) => days.some((d) => d.slots.some((s) => s.value === value));

// "Today at 6:30 PM", "Sat, Oct 3 at 10:00 AM".
export function describeTime(value: string, timezone: string | null | undefined, epochMs = Date.now()): string {
  const ms = toMs(value);
  if (!Number.isFinite(ms)) return '';
  const today = Math.floor(storeNow(timezone, epochMs) / DAY_MS) * DAY_MS;
  return `${dayLabel(Math.floor(ms / DAY_MS) * DAY_MS, today)} at ${timeFormat.format(new Date(ms))}`;
}

// "New York" from "America/New_York", for the note that times are the shop's own.
export const timezoneCity = (timezone: string | null | undefined) => (timezone ? (timezone.split('/').pop() ?? '').replace(/_/g, ' ') : '');
