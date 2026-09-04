import { ChannelAdapter } from './channelAdapter.js';

/**
 * Web browser channel. Identity is a device id the client generates once and
 * keeps in localStorage; the server never issues a session cookie, which is why
 * the same endpoints work unchanged for a bot or a mobile app.
 */
export class WebChannelAdapter extends ChannelAdapter {
  constructor() {
    super({ name: 'web' });
  }

  resolveVoter(context = {}) {
    const voterId =
      context.voterId ?? context.body?.voter_id ?? context.headers?.['x-device-id'] ?? '';
    return { voterId: this.assertVoterId(voterId), ip: context.ip ?? null };
  }
}
