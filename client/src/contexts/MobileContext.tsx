/**
 * MobileContext — Provides isMobile boolean to the entire app via context.
 *
 * Wraps the top-level App so any component can call useMobile() to check
 * whether the viewport is below 768px without adding its own listener.
 */
import React, { createContext, useContext } from 'react';
import { useIsMobile } from '../hooks/useMediaQuery';

interface MobileContextValue {
  isMobile: boolean;
}

const MobileCtx = createContext<MobileContextValue>({ isMobile: false });

export function MobileProvider({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  return <MobileCtx.Provider value={{ isMobile }}>{children}</MobileCtx.Provider>;
}

/** Returns true when the viewport is at most 768px wide. */
export function useIsMobileContext(): boolean {
  return useContext(MobileCtx).isMobile;
}

/** Alias for useIsMobileContext. */
export const useMobile = useIsMobileContext;
