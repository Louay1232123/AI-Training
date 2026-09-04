import { ChannelAdapter } from './channelAdapter.js';

/**
 * Native mobile app channel. Identity is a per-install id sent in the body or
 * an `x-device-id` header -- same contract as the web, kept separate so app
 * installs and browser devices are counted as distinct voters.
 */
export class AppChannelAdapter extends ChannelAdapter {
  constructor() {
    super({ name: 'app' });
  }

  resolveVoter(context = {}) {
    const voterId =
      context.voterId ?? context.body?.voter_id ?? context.headers?.['x-device-id'] ?? '';
    return { voterId: this.assertVoterId(voterId), ip: context.ip ?? null };
  }
}
