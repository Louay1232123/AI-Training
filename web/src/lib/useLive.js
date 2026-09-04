import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribe, onStatusChange } from './realtime.js';

// Refetch cadence. The 3s poll is the promised floor when the socket is down;
// while it is up we still refetch occasionally as a safety net.
const POLL_MS = 3000;
const POLL_MS_WHEN_CONNECTED = 15_000;

/** Tracks the shared socket's state so the UI can show a live/offline badge. */
export function useRealtimeStatus() {
  const [status, setStatus] = useState('connecting');
  useEffect(() => onStatusChange(setStatus), []);
  return status;
}

/**
 * Keeps a value fresh from `fetcher`, refetching on a timer and immediately
 * whenever a matching WebSocket message arrives.
 *
 * Failure handling matters on stadium wifi: a failed FIRST load is an `error`
 * (there is nothing to show), while a failed background refresh only sets
 * `stale` and leaves the last good data on screen.
 *
 * @param {object} options
 * @param {() => Promise<any>} options.fetcher
 * @param {string} options.topic  poll id to subscribe to, or '*' for all polls
 * @param {(message: object) => any} [options.fromMessage]
 *        pulls a ready-to-use value straight out of a socket message,
 *        avoiding a refetch
 */
export function useLive({ fetcher, topic, fromMessage }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const socketStatus = useRealtimeStatus();

  // Held in refs so a changing function identity never restarts the timer.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const fromMessageRef = useRef(fromMessage);
  fromMessageRef.current = fromMessage;
  const hasDataRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await fetcherRef.current();
      hasDataRef.current = true;
      setData(next);
      setError(null);
      setStale(false);
    } catch (nextError) {
      if (hasDataRef.current) setStale(true);
      else setError(nextError);
    } finally {
      setLoading(false);
    }
  }, []);

  // Subscription + first load. Deliberately NOT keyed on socket status: the
  // socket flapping must never tear down and rebuild the subscription.
  useEffect(() => {
    hasDataRef.current = false;
    setLoading(true);
    let cancelled = false;

    refresh();

    const unsubscribe = subscribe(topic, (message) => {
      if (cancelled) return;
      const direct = fromMessageRef.current?.(message);
      if (direct != null) {
        hasDataRef.current = true;
        setData(direct);
        setStale(false);
        setError(null);
      } else {
        refresh();
      }
    });

    // A phone back from standby, or off a dead cell, should catch up now.
    const onWake = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);

    return () => {
      cancelled = true;
      unsubscribe();
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [topic, refresh]);

  // Fallback refetch. Only this timer depends on the connection state, so a
  // reconnect just changes the cadence rather than restarting anything.
  //
  // The relaxed cadence applies only while the socket is up AND fetches are
  // working: once a refresh has failed we go back to 3s, because a live socket
  // is no proof the API is reachable (and it makes recovery quick).
  useEffect(() => {
    const healthy = socketStatus === 'open' && !stale;
    const interval = setInterval(refresh, healthy ? POLL_MS_WHEN_CONNECTED : POLL_MS);
    return () => clearInterval(interval);
  }, [refresh, socketStatus, stale]);

  return { data, error, stale, loading, refresh, setData };
}
