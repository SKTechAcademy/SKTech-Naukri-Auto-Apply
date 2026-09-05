import 'dotenv/config';
import { Runner, root } from './runner.js';
import { CandidateStore } from './candidates.js';
const store = new CandidateStore(root);
await store.init();
const id = process.argv[2];
if (!id) {
  console.log('Run candidates through the SK Tech dashboard: npm start');
  console.log('Each candidate must have a saved profile and their own verified Naukri session.');
} else {
  // Browser and process ownership are managed by the dashboard server only.
  throw new Error('CLI application runs are disabled. Use the candidate-specific dashboard to avoid conflicting sessions.');
}
