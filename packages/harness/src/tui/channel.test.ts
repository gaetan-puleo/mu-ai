import { assertEquals } from '@std/assert';
import type { Message } from 'mu-core';
import { type Terminal, text } from 'mu-tui';
import type { Channel } from '../channels';
import { createChatApp } from './channel';

class FakeTerminal implements Terminal {
  columns = 40;
  rows = 10;
  output = '';
  write(data: string): void {
    this.output += data;
  }
  hideCursor(): void {}
  showCursor(): void {}
  clearScreen(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  moveBy(): void {}
}

const plain = (raw: string): string =>
  raw
    // deno-lint-ignore no-control-regex
    .replace(/\x1b\][0-9];[^\x07]*\x07/g, '')
    // deno-lint-ignore no-control-regex
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    // deno-lint-ignore no-control-regex
    .replace(/\x1b[78]/g, '');

type TestChannel = Channel & { emit(event: { type: string; input?: unknown; error?: unknown }): void };

const fakeChannel = (messages: Message[]): TestChannel => {
  let listener: ((event: never) => void) | undefined;
  return {
    id: 'c1',
    title: 'General',
    started: true,
    get messages() {
      return messages;
    },
    send: async () => {},
    abort: () => {},
    subscribe: (l) => {
      listener = l;
      return () => {
        listener = undefined;
      };
    },
    emit: (event) => listener?.(event as never),
  };
};

Deno.test('createChatApp renders the channel title + the transcript', () => {
  const term = new FakeTerminal();
  const channel = fakeChannel([
    { role: 'user', content: [{ type: 'text', text: 'salut' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'bonjour' }] },
  ]);

  createChatApp(channel, { terminal: term }).tui.renderNow();

  const out = plain(term.output);
  assertEquals(out.includes('General'), true);
  assertEquals(out.includes('salut'), true);
  assertEquals(out.includes('bonjour'), true);
  assertEquals(out.includes('you'), true);
  assertEquals(out.includes('agent'), true);
});

Deno.test('the statusline reflects the turn state', () => {
  const term = new FakeTerminal();
  const channel = fakeChannel([]);
  const app = createChatApp(channel, { terminal: term });

  app.tui.renderNow();
  assertEquals(plain(term.output).includes('ready'), true);

  channel.emit({ type: 'turn_start', input: { role: 'user', content: [] } });
  term.output = '';
  app.tui.renderNow();
  assertEquals(plain(term.output).includes('thinking'), true);

  channel.emit({ type: 'turn_end' });
  term.output = '';
  app.tui.renderNow();
  assertEquals(plain(term.output).includes('ready'), true);
});

Deno.test('a kit component (text) can be replaced globally', () => {
  const term = new FakeTerminal();
  const channel = fakeChannel([{ role: 'user', content: [{ type: 'text', text: 'salut' }] }]);

  createChatApp(channel, {
    terminal: term,
    components: { text: (value) => text(`«${value}»`) },
  }).tui.renderNow();

  const out = plain(term.output);
  // le wrapper personnalise touche header ET messages (tous passent par kit.text)
  assertEquals(out.includes('«'), true);
});

Deno.test('each slot is overridable', () => {
  const term = new FakeTerminal();
  const channel = fakeChannel([{ role: 'user', content: [{ type: 'text', text: 'salut' }] }]);

  createChatApp(channel, {
    terminal: term,
    slots: {
      header: () => text('HEADER PERSO'),
      message: () => text('MSG PERSO'),
    },
  }).tui.renderNow();

  const out = plain(term.output);
  assertEquals(out.includes('HEADER PERSO'), true);
  assertEquals(out.includes('MSG PERSO'), true);
  assertEquals(out.includes('General'), false);
  assertEquals(out.includes('salut'), false);
});
