const DEVICE_KEY = 'cricket-polls.device-id';
const VOTES_KEY = 'cricket-polls.votes';

/** localStorage that never throws (private mode, storage disabled, quota). */
const safeStorage = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
};

// If localStorage is unavailable the id lives for the tab only. Voting still
// works; the server's per-IP ceiling is the remaining guard.
let memoryDeviceId = null;

/**
 * A stable per-device id, generated once. This is the `voter_id` the API sees:
 * an opaque string with no session or cookie behind it, which is exactly why
 * the same endpoint serves a bot or the mobile app.
 */
export function getDeviceId() {
  const stored = safeStorage.get(DEVICE_KEY);
  if (stored) return stored;

  const id =
    globalThis.crypto?.randomUUID?.() ??
    `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  if (!safeStorage.set(DEVICE_KEY, id)) {
    memoryDeviceId = memoryDeviceId ?? id;
    return memoryDeviceId;
  }
  return id;
}

/* --- local record of votes cast, so results show instantly after a reload --- */

function readVotes() {
  try {
    return JSON.parse(safeStorage.get(VOTES_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export const getLocalVote = (pollId) => readVotes()[pollId] ?? null;

export function rememberVote(pollId, optionId) {
  const votes = readVotes();
  votes[pollId] = optionId;
  safeStorage.set(VOTES_KEY, JSON.stringify(votes));
}
