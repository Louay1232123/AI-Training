import { badRequest } from '../lib/errors.js';
import { WebChannelAdapter } from './webChannel.js';
import { AppChannelAdapter } from './appChannel.js';
import { ChatChannelAdapter } from './chatChannel.js';

/**
 * Channel registry. Adding a delivery surface means adding one line here --
 * routes, services and SQL stay untouched.
 */
const registry = new Map();

export function registerChannel(adapter) {
  registry.set(adapter.name, adapter);
  return adapter;
}

registerChannel(new WebChannelAdapter());
registerChannel(new AppChannelAdapter());
// PHASE 2: transport not built yet, but votes on these channels already work.
registerChannel(new ChatChannelAdapter({ name: 'whatsapp', idPrefix: 'wa' }));
registerChannel(new ChatChannelAdapter({ name: 'telegram', idPrefix: 'tg' }));

export function getChannel(name = 'web') {
  const adapter = registry.get(name);
  if (!adapter) {
    throw badRequest(
      `Unknown channel "${name}". Known channels: ${listChannels().join(', ')}.`,
    );
  }
  return adapter;
}

export const listChannels = () => [...registry.keys()];
