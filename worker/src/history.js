import fs from 'node:fs/promises';
export async function loadHistory(file) { try { const value = JSON.parse(await fs.readFile(file, 'utf8')); return Array.isArray(value) ? value : []; } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }
export async function saveHistory(file, history) { const temporary = `${file}.tmp`; await fs.writeFile(temporary, JSON.stringify(history, null, 2)); await fs.rename(temporary, file); }
export function shouldSkip(history, url) { return history.some(item => item.url === url && ['APPLIED', 'ALREADY_APPLIED'].includes(item.status)); }
