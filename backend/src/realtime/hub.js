import { WebSocketServer } from 'ws';

/**
 * Minimal pub/sub over WebSockets. Channel-agnostic: it broadcasts poll events
 * to whoever subscribed, so a bot bridge or the mobile app can listen on the
 * same socket the web scoreboard uses.
 *
 * Clients send:  { "type": "subscribe",   "poll_id": "..." }  ("*" for all polls)
 *                { "type": "unsubscribe", "poll_id": "..." }
 *                { "type": "ping" }
 * Clients receive: { "type": "results" | "poll_created" | "poll_closed", ... }
 *
 * The web app also polls the REST endpoint on a timer, so a dropped socket on
 * patchy stadium wifi degrades to slower updates rather than a stale screen.
 */

const HEARTBEAT_MS = 30_000;

let wss;

const send = (socket, payload) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
};

const subscribedTo = (socket, pollId) =>
  socket.subscriptions?.has('*') || socket.subscriptions?.has(pollId);

export function attachRealtime(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (socket) => {
    socket.subscriptions = new Set();
    socket.isAlive = true;

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return send(socket, { type: 'error', message: 'Expected JSON.' });
      }

      switch (message.type) {
        case 'subscribe':
          socket.subscriptions.add(message.poll_id ?? '*');
          return send(socket, { type: 'subscribed', poll_id: message.poll_id ?? '*' });
        case 'unsubscribe':
          socket.subscriptions.delete(message.poll_id ?? '*');
          return send(socket, { type: 'unsubscribed', poll_id: message.poll_id ?? '*' });
        case 'ping':
          return send(socket, { type: 'pong' });
        default:
          return send(socket, { type: 'error', message: `Unknown type "${message.type}".` });
      }
    });
  });

  // Drop sockets that silently died (common on flaky mobile networks).
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}

/** Pushes fresh results to everyone watching this poll (or all polls). */
export function broadcastResults(results) {
  if (!wss) return;
  const payload = JSON.stringify({ type: 'results', poll_id: results.poll.id, results });
  for (const socket of wss.clients) {
    if (socket.readyState === socket.OPEN && subscribedTo(socket, results.poll.id)) {
      socket.send(payload);
    }
  }
}

/** Announces a lifecycle change so the live list re-renders without a refetch. */
export function broadcastPollEvent(type, poll) {
  if (!wss) return;
  const payload = JSON.stringify({ type, poll_id: poll.id, poll });
  for (const socket of wss.clients) {
    if (socket.readyState === socket.OPEN && subscribedTo(socket, poll.id)) {
      socket.send(payload);
    }
  }
}

export function closeRealtime() {
  wss?.close();
  wss = undefined;
}
