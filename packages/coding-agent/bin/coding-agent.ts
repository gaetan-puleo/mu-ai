#!/usr/bin/env -S deno run -A
import { install, uninstall } from '../src/install';
import { main } from '../src/main';

async function run(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'install') {
    if (!arg) throw new Error('usage: mu install <npm:spec | path.ts>');
    await install(arg);
    return;
  }
  if (cmd === 'uninstall') {
    if (!arg) throw new Error('usage: mu uninstall <npm:spec>');
    uninstall(arg);
    return;
  }
  await main();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
