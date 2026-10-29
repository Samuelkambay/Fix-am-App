import { pool } from '../db.js';
import { runAllJobs } from './scheduler.js';

runAllJobs()
  .then((r) => console.log(r))
  .finally(() => pool.end());
