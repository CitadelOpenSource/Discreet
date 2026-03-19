/**
 * useMediaQuery — React hook that tracks a CSS media query.
 *
 * Returns true when the query matches, false otherwise.
 * Listens for changes via matchMedia and cleans up on unmount.
 *
 * Usage:
 *   const isMobile = useMediaQuery('(max-width: 768px)');
 */
import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);

    // Sync initial state (SSR hydration safety)
    setMatches(mql.matches);

    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/** Convenience hook: true when viewport is at most 768px wide. */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 768px)');
}
