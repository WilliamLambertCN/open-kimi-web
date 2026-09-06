#!/usr/bin/env node
import { run } from '../src/cli.mjs';

run(process.argv).catch((err) => {
  console.error(`open-kimi-web: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
