import fs from 'fs';
import path from 'path';

const resolveDefaultDataRoot = () => {
  if (process.env.DATA_ROOT?.trim()) {
    return path.resolve(process.env.DATA_ROOT.trim());
  }
  if (fs.existsSync('/data')) {
    return '/data';
  }
  return path.resolve(process.cwd(), 'data');
};

export const dataRoot = resolveDefaultDataRoot();

export const resolveDataPath = (...parts: string[]) => path.join(dataRoot, ...parts);
