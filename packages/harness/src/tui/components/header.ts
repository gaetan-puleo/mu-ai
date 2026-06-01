import type { Component } from 'mu-tui';
import type { ChatContext } from '../types';

export const header = (ctx: ChatContext): Component => ctx.components.text(`\x1b[1m${ctx.channel.title}\x1b[0m`);
