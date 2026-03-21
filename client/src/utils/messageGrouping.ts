/**
 * messageGrouping — Utilities for message display: grouping consecutive
 * messages from the same author and inserting date separators.
 */

/** Check if two messages should be grouped (same author within 5 minutes). */
export function shouldGroup(
  prev: { author_id: string; created_at: string } | null,
  curr: { author_id: string; created_at: string },
): boolean {
  if (!prev) return false;
  if (prev.author_id !== curr.author_id) return false;
  const prevTime = new Date(prev.created_at).getTime();
  const currTime = new Date(curr.created_at).getTime();
  return Math.abs(currTime - prevTime) < 5 * 60 * 1000; // 5 minutes
}

/** Check if a date separator should be inserted between two messages. */
export function needsDateSeparator(
  prev: { created_at: string } | null,
  curr: { created_at: string },
): boolean {
  if (!prev) return true; // Always show separator before first message.
  const prevDate = new Date(prev.created_at).toDateString();
  const currDate = new Date(curr.created_at).toDateString();
  return prevDate !== currDate;
}
