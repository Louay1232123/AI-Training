import { getDeviceId } from './device.js';

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details ?? {};
  }
  /** True when retrying might plausibly work (offline, timeout, 5xx). */
  get isTransient() {
    return this.status === 0 || this.status >= 500;
  }
}

/**
 * One fetch wrapper for the whole app: aborts slow requests, retries transient
 * failures once, and turns every error into an ApiError with the server's code.
 * Stadium wifi drops packets, so a single silent retry saves a lot of taps.
 */
async function request(path, { method = 'GET', body, headers = {}, retry = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const error = payload?.error ?? {};
      throw new ApiError(
        response.status,
        error.code ?? 'error',
        error.message ?? `Request failed (${response.status}).`,
        error,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.isTransient && retry) return request(path, { method, body, headers, retry: false });
      throw error;
    }
    // Network failure or timeout.
    if (retry) return request(path, { method, body, headers, retry: false });
    throw new ApiError(
      0,
      error.name === 'AbortError' ? 'timeout' : 'offline',
      "Can't reach the scoreboard. Check your connection.",
    );
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ public */

export const getLivePolls = () => request('/api/polls/live').then((data) => data.polls);

export const getPoll = (id) => request(`/api/polls/${id}`).then((data) => data.poll);

export const getResults = (id) => request(`/api/polls/${id}/results`);

export const getHistory = () => request('/api/polls/history').then((data) => data.polls);

export const getMyVote = (pollId) =>
  request(`/api/polls/${pollId}/my-vote?voter_id=${encodeURIComponent(getDeviceId())}`).then(
    (data) => data.vote,
  );

/**
 * Casts a vote as this device on the web channel. `voter_id` is sent explicitly
 * rather than inferred from a session — the same call shape a bot would make.
 */
export const vote = (pollId, optionId) =>
  request(`/api/polls/${pollId}/vote`, {
    method: 'POST',
    body: { option_id: optionId, voter_id: getDeviceId(), channel: 'web' },
    // Never retry a write: a lost response would look like a double vote.
    retry: false,
  });

/* ------------------------------------------------------------------- admin */

const adminHeaders = (password) => ({ Authorization: `Bearer ${password}` });

export const verifyAdmin = (password) =>
  request('/api/admin/session', { method: 'POST', headers: adminHeaders(password) });

export const adminListPolls = (password) =>
  request('/api/admin/polls', { headers: adminHeaders(password) }).then((data) => data.polls);

export const adminCreatePoll = (password, poll) =>
  request('/api/admin/polls', {
    method: 'POST',
    headers: adminHeaders(password),
    body: poll,
    retry: false,
  }).then((data) => data.poll);

export const adminUpdatePoll = (password, id, patch) =>
  request(`/api/admin/polls/${id}`, {
    method: 'PATCH',
    headers: adminHeaders(password),
    body: patch,
    retry: false,
  }).then((data) => data.poll);

export const adminClosePoll = (password, id) =>
  request(`/api/admin/polls/${id}/close`, {
    method: 'POST',
    headers: adminHeaders(password),
    retry: false,
  });

export const adminOpenPoll = (password, id) =>
  request(`/api/admin/polls/${id}/open`, {
    method: 'POST',
    headers: adminHeaders(password),
    retry: false,
  });

export const adminDeletePoll = (password, id) =>
  request(`/api/admin/polls/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(password),
    retry: false,
  });

/** WebSocket URL derived from the API base, so one env var configures both. */
export function realtimeUrl() {
  if (BASE) {
    return `${BASE.replace(/^http/, 'ws')}/ws`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws`;
}
