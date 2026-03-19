import fs from 'fs';
import path from 'path';

const loadDotEnv = () => {
  const envPath = path.resolve(new URL('../.env', import.meta.url).pathname);
  if (!fs.existsSync(envPath)) {
    return;
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [key, ...rest] = line.split('=');
    if (!key) continue;
    const value = rest.join('=').trim();
    if (value === '') continue;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
};

loadDotEnv();
