import fs from 'node:fs/promises';
import { jobIdentity } from './search.js';
export async function loadHistory(file) { try { const value = JSON.parse(await fs.readFile(file, 'utf8')); return Array.isArray(value) ? value : []; } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }
export async function saveHistory(file, history) { const temporary = `${file}.tmp`; await fs.writeFile(temporary, JSON.stringify(history, null, 2)); await fs.rename(temporary, file); }
export function shouldSkip(history, url) { return history.some(item => {
  try { return jobIdentity(item.url) === jobIdentity(url) && ['APPLIED', 'ALREADY_APPLIED', 'SUBMITTING', 'SUBMISSION_UNCONFIRMED'].includes(item.status); }
  catch { return false; }
}); }
