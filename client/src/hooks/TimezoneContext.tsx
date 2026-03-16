import React, { createContext, useContext, useState, useCallback } from 'react';

const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

interface TimezoneCtx {
  timezone: string;
  setTimezone: (tz: string) => void;
  /** Format a date string or Date using the user's timezone. */
  formatTime: (d: string | Date, opts?: Intl.DateTimeFormatOptions) => string;
  formatDate: (d: string | Date, opts?: Intl.DateTimeFormatOptions) => string;
  /** Progressive relative: "Just now", "5m ago", "3:45 PM", "Yesterday 3:45 PM", "Mar 14, 3:45 PM" */
  formatRelative: (d: string | Date) => string;
  /** Full datetime with timezone for tooltip: "Friday, March 14, 2026 3:45:12 PM EST" */
  formatFullTooltip: (d: string | Date) => string;
  /** Date divider label: "Today", "Yesterday", or "March 14, 2026" */
  dateDividerLabel: (d: string | Date) => string;
}

const TimezoneContext = createContext<TimezoneCtx>({
  timezone: detected,
  setTimezone: () => {},
  formatTime: (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  formatDate: (d) => new Date(d).toLocaleDateString(),
  formatRelative: (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  formatFullTooltip: (d) => new Date(d).toLocaleString(),
  dateDividerLabel: (d) => new Date(d).toLocaleDateString(),
});

export const useTimezone = () => useContext(TimezoneContext);

export const detectedTimezone = detected;

/** Get the date parts (year, month, day) in a given timezone for comparison. */
function tzDateParts(date: Date, tz: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return {
    year: Number(parts.find(p => p.type === 'year')?.value),
    month: Number(parts.find(p => p.type === 'month')?.value),
    day: Number(parts.find(p => p.type === 'day')?.value),
  };
}

function sameTzDay(a: Date, b: Date, tz: string): boolean {
  const ap = tzDateParts(a, tz);
  const bp = tzDateParts(b, tz);
  return ap.year === bp.year && ap.month === bp.month && ap.day === bp.day;
}

function yesterdayInTz(now: Date, target: Date, tz: string): boolean {
  // Subtract 1 day from now and check if same day as target
  const yesterday = new Date(now.getTime() - 86400000);
  return sameTzDay(yesterday, target, tz);
}

export function TimezoneProvider({ children }: { children: React.ReactNode }) {
  const [timezone, setTimezone] = useState(detected);

  const formatTime = useCallback((d: string | Date, opts?: Intl.DateTimeFormatOptions) => {
    const date = typeof d === 'string' ? new Date(d) : d;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: timezone, ...opts });
  }, [timezone]);

  const formatDate = useCallback((d: string | Date, opts?: Intl.DateTimeFormatOptions) => {
    const date = typeof d === 'string' ? new Date(d) : d;
    return date.toLocaleDateString(undefined, { timeZone: timezone, ...opts });
  }, [timezone]);

  const formatRelative = useCallback((d: string | Date): string => {
    const date = typeof d === 'string' ? new Date(d) : d;
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);

    // Future, immediate, or < 1 minute
    if (diffSec < 0 || diffSec < 60) return 'Just now';

    // < 1 hour
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;

    const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: timezone });

    // Same day
    if (sameTzDay(now, date, timezone)) return time;

    // Yesterday
    if (yesterdayInTz(now, date, timezone)) return `Yesterday ${time}`;

    // Older — "Mar 14, 3:45 PM"
    const monthDay = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: timezone });
    return `${monthDay}, ${time}`;
  }, [timezone]);

  const formatFullTooltip = useCallback((d: string | Date): string => {
    const date = typeof d === 'string' ? new Date(d) : d;
    return date.toLocaleString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      timeZone: timezone,
      timeZoneName: 'short',
    });
  }, [timezone]);

  const dateDividerLabel = useCallback((d: string | Date): string => {
    const date = typeof d === 'string' ? new Date(d) : d;
    const now = new Date();

    if (sameTzDay(now, date, timezone)) return 'Today';
    if (yesterdayInTz(now, date, timezone)) return 'Yesterday';

    return date.toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: timezone,
    });
  }, [timezone]);

  return (
    <TimezoneContext.Provider value={{ timezone, setTimezone, formatTime, formatDate, formatRelative, formatFullTooltip, dateDividerLabel }}>
      {children}
    </TimezoneContext.Provider>
  );
}
