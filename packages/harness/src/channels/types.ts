import type { ContentPart, Message } from 'mu-core';
import type { AgentSessionEvent } from '../session';

export type ChannelEvent =
  | AgentSessionEvent
  | { type: 'channel_open'; title: string }
  | { type: 'channel_close' };

export type ChannelManagerEvent = { channelId: string } & ChannelEvent;

export interface Channel {
  readonly id: string;
  readonly title: string;
  readonly started: boolean;
  readonly messages: readonly Message[];
  send(input: string | ContentPart[]): Promise<void>;
  abort(): void;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
}

export interface ChannelManager {
  open(opts?: { id?: string; title?: string }): Channel;
  get(id: string): Channel | undefined;
  list(): Channel[];
  close(id: string): void;
  subscribe(listener: (event: ChannelManagerEvent) => void): () => void;
}
