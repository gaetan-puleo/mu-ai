import type { Channel } from '../channels';
import { createChatApp } from './channel';
import type { ChatApp, ChatAppOptions } from './types';

export * from './types';
export * from './kit';
export * from './components';
export { createChatApp } from './channel';

export const runChat = (channel: Channel, opts?: ChatAppOptions): ChatApp => {
  const app = createChatApp(channel, opts);
  app.start();
  return app;
};
