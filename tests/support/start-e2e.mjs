import { startHarness } from './harness.mjs';

const harness = await startHarness({ reset: true });
console.log(`PaperLab E2E harness listening on http://127.0.0.1:${process.env.E2E_PORT || 8788}`);

async function stop() {
  await harness.close();
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
