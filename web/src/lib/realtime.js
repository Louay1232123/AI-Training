import { realtimeUrl } from './api.js';

/**
 * One shared WebSocket for the whole app, with reconnect backoff.
 *
 * Everything that needs live data subscribes here; if the socket is down the
 * hooks fall back to timed refetches, so patchy wifi degrades to slower
 * updates rather than a frozen board.
 */

const listeners = new Map(); // poll id (or '*') -> Set<handler>
const statusListeners = new Set();

let socket = null;
let status = 'connecting';
let attempt = 0;
let reconnectTimer = null;
// The socket is not closed the instant the last subscriber leaves: a route
// change or a StrictMode remount would otherwise tear it down and rebuild it.
let idleCloseTimer = null;
const IDLE_CLOSE_MS = 10_000;

/**
 * The status reported to the UI. `idle` means nothing on this screen wants live
 * data (the admin console polls instead), so a badge claiming "reconnecting"
 * there would be misleading.
 */
const effectiveStatus = () => (listeners.size === 0 ? 'idle' : status);

let lastReported = null;

function notifyStatus() {
  const next = effectiveStatus();
  if (next === lastReported) return;
  lastReported = next;
  for (const listener of statusListeners) listener(next);
}

function setStatus(next) {
  status = next;
  notifyStatus();
}

const sendSubscribe = (pollId) => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'subscribe', poll_id: pollId }));
  }
};

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  setStatus(attempt === 0 ? 'connecting' : 'reconnecting');

  try {
    socket = new WebSocket(realtimeUrl());
  } catch {
    return scheduleReconnect();
  }

  socket.onopen = () => {
    attempt = 0;
    setStatus('open');
    // Re-subscribe everything after a reconnect.
    for (const pollId of listeners.keys()) sendSubscribe(pollId);
  };

  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    const handlers = [
      ...(listeners.get(message.poll_id) ?? []),
      ...(listeners.get('*') ?? []),
    ];
    for (const handler of handlers) handler(message);
  };

  socket.onclose = (event) => {
    // Ignore a close for a socket we already replaced or deliberately dropped.
    if (socket && event.target !== socket) return;
    setStatus('closed');
    scheduleReconnect();
  };

  socket.onerror = () => socket?.close();
}

function scheduleReconnect() {
  if (reconnectTimer || listeners.size === 0) return;
  // 1s, 2s, 4s, 8s, capped at 15s -- fast enough to feel instant on a brief
  // dropout, slow enough not to hammer the API from a whole stand at once.
  const delay = Math.min(1000 * 2 ** attempt, 15_000);
  attempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

/**
 * Subscribes to messages for one poll id, or '*' for every poll.
 * @returns {() => void} unsubscribe
 */
export function subscribe(pollId, handler) {
  clearTimeout(idleCloseTimer);
  idleCloseTimer = null;

  if (!listeners.has(pollId)) listeners.set(pollId, new Set());
  listeners.get(pollId).add(handler);

  connect();
  sendSubscribe(pollId);
  notifyStatus();

  return () => {
    const handlers = listeners.get(pollId);
    handlers?.delete(handler);
    if (handlers?.size === 0) listeners.delete(pollId);

    notifyStatus();

    if (listeners.size === 0 && !idleCloseTimer) {
      idleCloseTimer = setTimeout(() => {
        idleCloseTimer = null;
        if (listeners.size > 0) return;
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        const closing = socket;
        socket = null;
        closing?.close();
      }, IDLE_CLOSE_MS);
    }
  };
}

export function onStatusChange(listener) {
  statusListeners.add(listener);
  listener(effectiveStatus());
  return () => statusListeners.delete(listener);
}

export const getStatus = () => effectiveStatus();
