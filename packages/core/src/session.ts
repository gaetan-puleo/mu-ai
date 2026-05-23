import type { Message } from './types/Message';
import type { SessionState } from './types/Session';

export class Session {
  id: string;
  messages: Message[] = [];
  state: SessionState = 'idle';
  system?: string;
  parentId?: string;

  constructor(id: string, options: { system?: string; parentId?: string } = {}) {
    this.id = id;
    this.system = options.system;
    this.parentId = options.parentId;
  }

  getLastMessage(): Message | undefined {
    return this.messages[this.messages.length - 1];
  }

  append(message: Message): void {
    this.messages.push(message);
  }

  fork(): Session {
    const forked = new Session(`${this.id}-${Date.now()}`, { system: this.system, parentId: this.id });
    forked.messages = [...this.messages];
    return forked;
  }
}
