#!/usr/bin/env -S node --import tsx
import { main } from '../src/main.js';

main().catch((err) => {
  console.error(err);
  process.exit(1);
});