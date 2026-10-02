'use client';

import { useId } from 'react';
import { timezoneCity, type ScheduleDay } from '@/lib/schedule';

export interface ScheduleProps {
  days: ScheduleDay[];
  // null means as soon as possible; otherwise the store's local wall-clock time, sent to the API unchanged.
  value: string | null;
  onChange: (value: string | null) => void;
  asapAvailable: boolean;
  prepMinutes: number | null;
  timezone: string | null;
  // True when a previously chosen time has passed or is no longer offered.
  expired: boolean;
}

export default function PickupTime({ days, value, onChange, asapAvailable, prepMinutes, timezone, expired }: ScheduleProps) {
  const id = useId();
  const later = value !== null;
  const day = days.find((d) => d.slots.some((s) => s.value === value)) ?? days[0];
  const canSchedule = days.length > 0;
  let elsewhere = false;
  try {
    elsewhere = !!timezone && Intl.DateTimeFormat().resolvedOptions().timeZone !== timezone;
  } catch {
    elsewhere = false;
  }

  if (!asapAvailable && !canSchedule) return null;

  return (
    <fieldset className="pickup" lang="en">
      <legend>Pickup time</legend>
      <div className="pickup__modes">
        <label className={`pickup__mode ${!later ? 'is-checked' : ''} ${!asapAvailable ? 'is-disabled' : ''}`}>
          <input type="radio" name={`${id}-mode`} checked={!later} disabled={!asapAvailable} onChange={() => onChange(null)} />
          <span className="pickup__title">As soon as possible</span>
          <span className="pickup__detail">{asapAvailable ? (prepMinutes ? `About ${prepMinutes} minutes` : 'Made to order') : 'Closed right now'}</span>
        </label>
        <label className={`pickup__mode ${later ? 'is-checked' : ''} ${!canSchedule ? 'is-disabled' : ''}`}>
          <input type="radio" name={`${id}-mode`} checked={later} disabled={!canSchedule} onChange={() => canSchedule && onChange(days[0].slots[0].value)} />
          <span className="pickup__title">Later</span>
          <span className="pickup__detail">{canSchedule ? 'Pick a day and time' : 'Not available'}</span>
        </label>
      </div>

      {later && day ? (
        <div className="pickup__when">
          <label>
            <span className="sr-only">Day</span>
            <select value={day.key} onChange={(e) => onChange(days.find((d) => d.key === e.target.value)!.slots[0].value)}>
              {days.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Time</span>
            <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
              {day.slots.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {expired ? (
        <p className="pickup__note pickup__note--warn" role="status">
          The pickup time you chose is no longer available, so we moved it. Please check it.
        </p>
      ) : null}
      {later && elsewhere ? <p className="pickup__note">Times are the shop’s local time ({timezoneCity(timezone)}).</p> : null}
    </fieldset>
  );
}
