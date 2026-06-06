import type { ContentPart, Message } from 'mu-core';
import { column, type Component, truncateToWidth, visibleWidth, wrapText } from 'mu-tui';
import type { AgentSessionEvent } from 'mu-harness';
import { renderMarkdown } from './markdown';
import { styleToAnsi, type Theme } from './theme';

const RESET = '\x1b[0m';
const PAD = 1;
const COLLAPSE_LIMIT = 8;

export type Entry =
  | { kind: 'user'; text: string }
  | { kind: 'reasoning'; text: string; closed: boolean }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool_call'; name: string; input: unknown }
  | { kind: 'shell'; cmd: string; output: string; error: boolean }
  | {
    kind: 'subagent';
    agent: string;
    status: SubAgentStatus;
    tools: number;
    activity: string;
    result: string;
    log: string[];
    open: boolean;
    messages?: readonly Message[];
  }
  | { kind: 'note'; text: string; error: boolean };

type ReasoningEntry = Extract<Entry, { kind: 'reasoning' }>;
export type SubAgentEntry = Extract<Entry, { kind: 'subagent' }>;

export type SubAgentStatus = 'running' | 'done' | 'error' | 'canceled';

export interface SubAgentHandle {
  addTool(label: string): void;
  finish(result: string): void;
  fail(message: string): void;
  cancel(): void;
}

const partsToText = (parts: readonly ContentPart[]): string =>
  parts.map((part) => (part.type === 'text' ? part.text : part.type === 'tool_result' ? partsToText(part.content) : ''))
    .join('');

const isToolResults = (message: Message): boolean =>
  message.content.length > 0 && message.content.every((part) => part.type === 'tool_result');

export class Transcript {
  entries: Entry[] = [];
  expanded = false;
  thinkingVisible = false;
  private pending: { kind: 'assistant'; text: string } | undefined;
  private pendingReasoning: ReasoningEntry | undefined;

  reset(): void {
    this.entries = [];
    this.pending = undefined;
    this.pendingReasoning = undefined;
  }

  private closeReasoning(): void {
    if (this.pendingReasoning) this.pendingReasoning.closed = !this.thinkingVisible;
    this.pendingReasoning = undefined;
  }

  toggleExpanded(): boolean {
    if (!this.entries.some((e) => e.kind === 'shell')) return false;
    this.expanded = !this.expanded;
    return true;
  }

  toggleReasoning(): boolean {
    this.thinkingVisible = !this.thinkingVisible;
    for (const entry of this.entries) {
      if (entry.kind === 'reasoning') entry.closed = !this.thinkingVisible;
    }
    return this.thinkingVisible;
  }

  appendUser(text: string): void {
    this.entries.push({ kind: 'user', text });
  }

  note(content: string, error = false): void {
    this.entries.push({ kind: 'note', text: content, error });
  }

  appendSubAgent(agent: string, messages?: readonly Message[]): SubAgentHandle {
    const entry: SubAgentEntry = {
      kind: 'subagent',
      agent,
      status: 'running',
      tools: 0,
      activity: '',
      result: '',
      log: [],
      open: false,
      messages,
    };
    this.entries.push(entry);
    return {
      addTool: (label) => {
        entry.tools += 1;
        entry.activity = label;
        entry.log.push(label);
      },
      finish: (result) => {
        entry.status = 'done';
        entry.activity = '';
        entry.result = result;
      },
      fail: (message) => {
        entry.status = 'error';
        entry.activity = '';
        entry.result = message;
      },
      cancel: () => {
        entry.status = 'canceled';
        entry.activity = '';
      },
    };
  }

  appendShell(cmd: string): { setOutput: (output: string, error?: boolean) => void } {
    const entry: Entry = { kind: 'shell', cmd, output: '', error: false };
    this.entries.push(entry);
    return {
      setOutput: (output, error = false) => {
        entry.output = output;
        entry.error = error;
      },
    };
  }

  seed(messages: readonly Message[]): void {
    this.reset();
    for (const message of messages) {
      if (message.role === 'system') continue;
      if (message.role === 'assistant') {
        const txt = partsToText(message.content);
        if (txt) this.entries.push({ kind: 'assistant', text: txt });
        for (const part of message.content) {
          if (part.type === 'tool_call') this.entries.push({ kind: 'tool_call', name: part.name, input: part.input });
        }
      } else if (!isToolResults(message)) {
        this.entries.push({ kind: 'user', text: partsToText(message.content) });
      }
    }
  }

  applyEvent(event: AgentSessionEvent): void {
    switch (event.type) {
      case 'turn_start':
        this.pending = undefined;
        this.pendingReasoning = undefined;
        return;
      case 'reasoning': {
        if (!this.pendingReasoning) {
          this.pendingReasoning = { kind: 'reasoning', text: '', closed: !this.thinkingVisible };
          this.entries.push(this.pendingReasoning);
        }
        this.pendingReasoning.text += event.text;
        return;
      }
      case 'text': {
        this.closeReasoning();
        if (!this.pending) {
          this.pending = { kind: 'assistant', text: '' };
          this.entries.push(this.pending);
        }
        this.pending.text += event.text;
        return;
      }
      case 'tool_call':
        this.closeReasoning();
        if (event.name === 'subagent') return;
        this.entries.push({ kind: 'tool_call', name: event.name, input: event.input });
        return;
      case 'message': {
        const message = event.message;
        if (message.role === 'assistant') {
          const txt = partsToText(message.content);
          if (this.pending) this.pending.text = txt;
          else if (txt) this.entries.push({ kind: 'assistant', text: txt });
          this.pending = undefined;
          this.closeReasoning();
        }
        return;
      }
      case 'turn_end':
      case 'done':
        this.pending = undefined;
        this.closeReasoning();
        return;
    }
  }
}

const stringifyArg = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(stringifyArg).filter(Boolean).join(' ');
  return JSON.stringify(value) ?? '';
};

const truncateText = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;

export function formatToolArgs(name: string, input: unknown, max = 120): string {
  if (input === null || typeof input !== 'object') return truncateText(String(input ?? ''), max);
  const args = input as Record<string, unknown>;
  if (name === 'edit' || name === 'write' || name === 'read' || name === 'list_dir') {
    return truncateText(stringifyArg(args.path), max);
  }
  if (name === 'bash') return truncateText(stringifyArg(args.cmd), max);
  if (name === 'subagent') return truncateText(stringifyArg(args.agent), max);
  return truncateText(Object.values(args).map(stringifyArg).filter(Boolean).join(' '), max);
}

const fit = (line: string, width: number): string => visibleWidth(line) > width ? truncateToWidth(line, width) : line;

const userEntry = (value: string, theme: Theme): Component => ({
  render: (s) => {
    if (s.width <= 0) return;
    const bg = theme.styles.userMessage.bg;
    if (bg) s.fill({ x: 0, y: 0, width: s.width, height: s.height }, bg);
    const muted = styleToAnsi(theme.styles.muted);
    const body = styleToAnsi(theme.styles.userMessage);
    const innerW = Math.max(1, s.width - PAD - 2 - PAD);
    const wrapped = value.trim().split('\n').flatMap((line) => wrapText(line, innerW));
    for (let i = 0; i < wrapped.length; i++) {
      if (i === 0) s.text(PAD, 0, `${muted}❯${RESET}`);
      s.text(PAD + 2, i, `${body}${wrapped[i]}${RESET}`);
    }
  },
});

const STICKY_MAX_LINES = 2;

export const stickyHeader = (value: string, theme: Theme): Component => ({
  render: (s) => {
    if (s.width <= 0) return;
    const muted = styleToAnsi({ ...theme.styles.muted, bg: theme.colors.surface });
    const body = styleToAnsi({ fg: theme.styles.userMessage.fg, bg: theme.colors.surface });
    const bgSgr = styleToAnsi({ bg: theme.colors.surface });
    const innerW = Math.max(1, s.width - PAD - 2 - PAD);
    const wrapped = value.trim().split('\n').flatMap((line) => wrapText(line, innerW));
    const lines = wrapped.slice(0, STICKY_MAX_LINES);
    const truncated = wrapped.length > lines.length;
    const h = lines.length + 1;
    const blank = `${bgSgr}${' '.repeat(s.width)}${RESET}`;
    for (let i = 0; i < h; i++) s.text(0, i, blank);
    for (let i = 0; i < lines.length; i++) {
      if (i === 0) s.text(PAD, 0, `${muted}❯${RESET}`);
      const last = i === lines.length - 1;
      const text = last && truncated ? `${truncateToWidth(lines[i], Math.max(1, innerW - 1))}…` : lines[i];
      s.text(PAD + 2, i, `${body}${text}${RESET}`);
    }
    s.text(0, lines.length, `${muted}${'─'.repeat(s.width)}${RESET}`);
  },
});

const assistantEntry = (value: string, theme: Theme): Component => ({
  render: (s) => {
    if (s.width <= 0) return;
    const innerW = Math.max(1, s.width - PAD * 2);
    const lines = renderMarkdown(value.trim() || '…', innerW, theme, PAD);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.bleed) s.text(0, i, fit(line.text, s.width));
      else s.text(PAD, i, fit(line.text, innerW));
    }
  },
});

const leftClick = (event: { type: string; kind?: string; button?: string }): boolean =>
  event.type === 'mouse' && event.kind === 'press' && event.button === 'left';

const reasoningComponent = (entry: ReasoningEntry, theme: Theme): Component => {
  const style = styleToAnsi(theme.styles.reasoning);
  if (entry.closed) {
    return {
      handleInput: (event) => {
        if (!leftClick(event)) return false;
        entry.closed = false;
        return true;
      },
      render: (s) => {
        if (s.width <= 0) return;
        s.text(PAD, 0, `${style}[thinking]${RESET}`);
      },
    };
  }
  return {
    render: (s) => {
      if (s.width <= 0) return;
      const innerW = Math.max(1, s.width - PAD * 2);
      const wrapped = entry.text.trim().split('\n').flatMap((line) => wrapText(line, innerW));
      for (let i = 0; i < wrapped.length; i++) s.text(PAD, i, `${style}${fit(wrapped[i], innerW)}${RESET}`);
    },
  };
};

const toolEntry = (name: string, input: unknown, theme: Theme): Component => ({
  render: (s) => {
    if (s.width <= 0) return;
    const muted = styleToAnsi(theme.styles.muted);
    const args = formatToolArgs(name, input);
    const line = args ? `→ ${name} ${args}` : `→ ${name}`;
    s.text(PAD, 0, `${muted}${fit(line, Math.max(1, s.width - PAD * 2))}${RESET}`);
  },
});

const noteEntry = (value: string, error: boolean, theme: Theme): Component => ({
  render: (s) => {
    if (s.width <= 0) return;
    const innerW = Math.max(1, s.width - PAD * 2);
    const trimmed = value.trim();
    if (error) {
      const head = styleToAnsi(theme.styles.errorPrefix);
      const tail = styleToAnsi(theme.styles.errorLine);
      const wrapped = trimmed.split('\n').flatMap((line) => wrapText(line, Math.max(1, innerW - 2)));
      for (let i = 0; i < wrapped.length; i++) {
        const prefix = i === 0 ? `${head}! ${RESET}` : '  ';
        s.text(PAD, i, `${prefix}${tail}${wrapped[i]}${RESET}`);
      }
    } else {
      const muted = styleToAnsi(theme.styles.muted);
      const wrapped = trimmed.split('\n').flatMap((line) => wrapText(line, innerW));
      for (let i = 0; i < wrapped.length; i++) s.text(PAD, i, `${muted}${fit(wrapped[i], innerW)}${RESET}`);
    }
  },
});

const shellEntry = (cmd: string, output: string, error: boolean, expanded: boolean, theme: Theme): Component => {
  const innerWidthFor = (w: number) => Math.max(1, w - 2);
  return {
    render: (s) => {
      if (s.width <= 0) return;
      const bg = error ? theme.colors.surfaceMuted : theme.colors.surface;
      s.fill({ x: 0, y: 0, width: s.width, height: s.height }, bg);
      const headerStyle = styleToAnsi({ fg: theme.colors.textMuted });
      const outputStyle = styleToAnsi({ fg: theme.colors.text });
      const innerW = innerWidthFor(s.width);
      s.text(1, 1, `${headerStyle}${fit(cmd.trim(), innerW)}${RESET}`);
      const all = wrapText(output.trim(), innerW);
      const lines = expanded || all.length <= COLLAPSE_LIMIT ? all : all.slice(0, COLLAPSE_LIMIT);
      const truncated = expanded ? 0 : Math.max(0, all.length - COLLAPSE_LIMIT);
      for (let i = 0; i < lines.length; i++) s.text(1, 3 + i, `${outputStyle}${lines[i]}${RESET}`);
      let bottom = 3 + lines.length;
      if (truncated > 0) {
        s.text(1, bottom, `${headerStyle}... ${truncated} more lines (ctrl+o)${RESET}`);
        bottom += 1;
      }
      s.text(0, bottom, '');
    },
  };
};

const SUBAGENT_ICON: Record<SubAgentStatus, string> = { running: '◐', done: '✓', error: '✗', canceled: '⊘' };

const subAgentEntry = (entry: SubAgentEntry, theme: Theme): Component => {
  const statusColor = entry.status === 'done'
    ? theme.colors.success
    : entry.status === 'error'
    ? theme.styles.errorPrefix.fg ?? theme.colors.danger
    : entry.status === 'canceled'
    ? theme.colors.textMuted
    : theme.colors.accent;
  return {
    handleInput: (event) => {
      if (!leftClick(event)) return false;
      entry.open = !entry.open;
      return true;
    },
    render: (s) => {
      if (s.width <= 0) return;
      const RAIL_W = 2;
      const innerW = Math.max(1, s.width - PAD - RAIL_W);
      const accent = styleToAnsi({ fg: statusColor, bold: true });
      const nameStyle = styleToAnsi({ fg: statusColor, bold: true });
      const muted = styleToAnsi(theme.styles.muted);
      const rail = `${accent}▌${RESET}`;

      const lines: string[] = [];
      const tools = entry.tools > 0 ? `${muted} · ${entry.tools} tool${entry.tools === 1 ? '' : 's'}${RESET}` : '';
      const hint = entry.status === 'running' ? '' : `${muted}  · click to open${RESET}`;
      lines.push(
        `${nameStyle}${
          SUBAGENT_ICON[entry.status]
        } ${entry.agent}${RESET}${muted} ${entry.status}${RESET}${tools}${hint}`,
      );

      if (entry.status === 'running') {
        lines.push(`${muted}→ ${fit(entry.activity || 'working…', Math.max(1, innerW - 2))}${RESET}`);
      } else if (entry.result) {
        const preview = entry.result.trim().split('\n').find((line) => line.trim() !== '') ?? '';
        lines.push(`${muted}→ ${fit(preview, Math.max(1, innerW - 2))}${RESET}`);
      }

      for (let i = 0; i < lines.length; i++) {
        s.text(PAD, i, rail);
        s.text(PAD + RAIL_W, i, lines[i]);
      }
    },
  };
};

export function entryComponent(entry: Entry, theme: Theme, expanded: boolean): Component {
  switch (entry.kind) {
    case 'user':
      return userEntry(entry.text, theme);
    case 'reasoning':
      return reasoningComponent(entry, theme);
    case 'assistant':
      return assistantEntry(entry.text, theme);
    case 'tool_call':
      return toolEntry(entry.name, entry.input, theme);
    case 'shell':
      return shellEntry(entry.cmd, entry.output || '…', entry.error, expanded, theme);
    case 'subagent':
      return subAgentEntry(entry, theme);
    case 'note':
      return noteEntry(entry.text, entry.error, theme);
  }
}

const withMarginBottom = (child: Component, rows: number): Component => ({
  render: (s) => {
    const h = s.measure(child, s.width);
    s.child(child, { x: 0, y: 0, width: s.width, height: h });
    if (rows > 0) s.text(0, h + rows - 1, '');
  },
});

export function transcriptComponent(model: Transcript, theme: Theme): Component {
  return {
    render: (s) => {
      const children: Component[] = [];
      for (const entry of model.entries) {
        const margin = entry.kind === 'tool_call' ? 0 : 1;
        children.push(withMarginBottom(entryComponent(entry, theme, model.expanded), margin));
      }
      column(children).render(s);
    },
  };
}
