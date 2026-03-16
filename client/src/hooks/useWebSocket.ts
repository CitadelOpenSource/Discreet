/**
 * useWebSocket — WebSocket event listener hook.
 * Subscribes to WebSocket events and calls handler on each event.
 * Automatically unsubscribes on cleanup.
 */
import { useEffect, useRef } from 'react';
import { api } from '../api/CitadelAPI';

type WsEventHandler = (event: any) => void;

/**
 * Subscribe to WebSocket events.
 * The handler is called for every WS message while the component is mounted.
 */
export function useWebSocket(handler: WsEventHandler, deps: any[] = []) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const fn = (data: any) => handlerRef.current(data);
    const unsub = api.onWsEvent(fn);
    return unsub;
  }, deps);
}

/**
 * Connect to a server's WebSocket channel.
 * Disconnects on cleanup.
 */
export function useServerWs(serverId: string | null | undefined) {
  useEffect(() => {
    if (!serverId) return;
    try { api.connectWs(serverId); } catch {}
    return () => api.disconnectWs();
  }, [serverId]);
}
