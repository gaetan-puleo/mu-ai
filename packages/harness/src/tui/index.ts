import { ChatApp, type ChatHost } from './chat';

export * from './chat';

export const runChat = (host: ChatHost): ChatApp => {
  const app = new ChatApp(host);
  void app.start();
  return app;
};
