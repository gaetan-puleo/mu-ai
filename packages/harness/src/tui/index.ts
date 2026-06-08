import { ChatApp, type ChatHost } from './chat';

export * from './chat';

/**
 * Builds and starts the unified chat TUI from a {@link ChatHost} config and
 * returns the running app. This is the single TUI base shared by all hosts
 * (config-on-runChat): supply the harness handles + feature toggles you want.
 */
export const runChat = (host: ChatHost): ChatApp => {
  const app = new ChatApp(host);
  void app.start();
  return app;
};
