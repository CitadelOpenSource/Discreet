/**
 * useNighttimeMode — Scheduled dark/quiet mode based on time of day.
 *
 * Checks every 60 seconds whether the current time falls within the
 * configured bedtime window. When active: forces dark theme, optionally
 * mutes notifications, and applies a blue-light reduction filter.
 */

export interface NighttimeConfig {
  enabled: boolean;
  bedtime: string;         // "22:00"
  wakeup: string;          // "07:00"
  days: boolean[];         // [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
  notifBehavior: 'normal' | 'muted' | 'priority_only';
  blueLightReduction: boolean;
}

const STORAGE_KEY = 'd_nighttime';
const OVERRIDE_KEY = 'd_nighttime_override';     // "on" = manually activated, "off" = session override
const MANUAL_UNTIL_KEY = 'd_nighttime_manual_until'; // ISO timestamp — manual activation until next wakeup

export const DEFAULT_CONFIG: NighttimeConfig = {
  enabled: false,
  bedtime: '22:00',
  wakeup: '07:00',
  days: [true, true, true, true, true, true, true],
  notifBehavior: 'normal',
  blueLightReduction: false,
};

export function loadConfig(): NighttimeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg: NighttimeConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

/** Parse "HH:MM" into minutes since midnight. */
function parseTime(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Check if the current time is within the bedtime window. */
export function isNighttimeNow(cfg: NighttimeConfig): boolean {
  if (!cfg.enabled) return false;

  const now = new Date();
  const day = now.getDay(); // 0=Sun
  if (!cfg.days[day]) return false;

  const mins = now.getHours() * 60 + now.getMinutes();
  const bed = parseTime(cfg.bedtime);
  const wake = parseTime(cfg.wakeup);

  // Handle overnight window (e.g., 22:00 → 07:00).
  if (bed > wake) {
    return mins >= bed || mins < wake;
  }
  // Same-day window (e.g., 01:00 → 06:00).
  return mins >= bed && mins < wake;
}

/** Check with manual override and session override. */
export function shouldActivate(cfg: NighttimeConfig): boolean {
  // Session override: "stay in day mode this session".
  const override = sessionStorage.getItem(OVERRIDE_KEY);
  if (override === 'off') return false;

  // Manual "turn on now" — active until next wakeup.
  const manualUntil = localStorage.getItem(MANUAL_UNTIL_KEY);
  if (manualUntil) {
    if (new Date(manualUntil) > new Date()) return true;
    localStorage.removeItem(MANUAL_UNTIL_KEY); // expired
  }

  return isNighttimeNow(cfg);
}

/** Manually activate until the next wakeup time. */
export function activateNow(cfg: NighttimeConfig): void {
  const now = new Date();
  const wake = parseTime(cfg.wakeup);
  const target = new Date(now);
  target.setHours(Math.floor(wake / 60), wake % 60, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  localStorage.setItem(MANUAL_UNTIL_KEY, target.toISOString());
  sessionStorage.removeItem(OVERRIDE_KEY);
}

/** Session override: stay in day mode until reload. */
export function overrideSession(): void {
  sessionStorage.setItem(OVERRIDE_KEY, 'off');
  localStorage.removeItem(MANUAL_UNTIL_KEY);
}

/** Clear session override. */
export function clearSessionOverride(): void {
  sessionStorage.removeItem(OVERRIDE_KEY);
}

/** Check if session override is active. */
export function hasSessionOverride(): boolean {
  return sessionStorage.getItem(OVERRIDE_KEY) === 'off';
}
