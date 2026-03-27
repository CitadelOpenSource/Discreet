/**
 * useDeviceDetection — Comprehensive device capability detection.
 *
 * Returns: isMobile, isTablet, isDesktop, isTouchDevice, orientation,
 * isStandalone (PWA). All values are reactive — debounced resize and
 * orientation listeners update them in real time.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

export interface DeviceInfo {
  isMobile: boolean;      // width < 768 OR (touch + no hover)
  isTablet: boolean;      // 768–1024 + touch
  isDesktop: boolean;     // width > 1024 OR (hover + no touch)
  isTouchDevice: boolean; // pointer: coarse or ontouchstart
  orientation: 'portrait' | 'landscape';
  isStandalone: boolean;  // PWA / installed app mode
  screenWidth: number;
  screenHeight: number;
}

const DEBOUNCE_MS = 150;

function detectTouch(): boolean {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window
    || navigator.maxTouchPoints > 0
    || window.matchMedia('(pointer: coarse)').matches;
}

function detectHover(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(hover: hover)').matches;
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as any).standalone === true;
}

function getOrientation(): 'portrait' | 'landscape' {
  if (typeof window === 'undefined') return 'portrait';
  if (screen.orientation?.type) {
    return screen.orientation.type.startsWith('portrait') ? 'portrait' : 'landscape';
  }
  return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
}

function compute(): DeviceInfo {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const h = typeof window !== 'undefined' ? window.innerHeight : 768;
  const touch = detectTouch();
  const hover = detectHover();
  const orientation = getOrientation();
  const standalone = detectStandalone();

  const isMobile = w < 768 || (touch && !hover);
  const isTablet = !isMobile && w <= 1024 && touch;
  const isDesktop = !isMobile && !isTablet;

  return { isMobile, isTablet, isDesktop, isTouchDevice: touch, orientation, isStandalone: standalone, screenWidth: w, screenHeight: h };
}

export function useDeviceDetection(): DeviceInfo {
  const [info, setInfo] = useState<DeviceInfo>(compute);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const update = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setInfo(compute()), DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    // Media query listeners for hover/touch changes (e.g. stylus connected)
    const mq = window.matchMedia('(hover: hover)');
    mq.addEventListener?.('change', update);

    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      mq.removeEventListener?.('change', update);
    };
  }, [update]);

  return info;
}
