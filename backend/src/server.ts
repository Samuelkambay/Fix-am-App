import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { startJobs } from './jobs/scheduler.js';

async function main() {
  const applied = await migrate();
  if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
  createApp().listen(config.port, () => console.log(`FixAm API listening on :${config.port} (payments: ${config.paymentMode})`));
  if (process.env.RUN_JOBS !== 'false') startJobs();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
