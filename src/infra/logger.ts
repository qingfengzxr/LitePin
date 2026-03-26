import fs from 'fs';
import path from 'path';
import pino, { multistream } from 'pino';
import { resolveDataPath } from './storagePaths.js';

const logDir = process.env.LOG_DIR || resolveDataPath('logs');
const logFile = process.env.LOG_FILE || path.join(logDir, 'litepin.log');
const maxBytes = Number(process.env.LOG_ROTATE_BYTES || 256 * 1024 * 1024);

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const formatTimestamp = (date: Date) => date.toISOString().replace(/[:.]/g, '-');

const createRotatingStream = (filePath: string, maxSize: number) => {
  let stream: fs.WriteStream | null = null;
  let currentSize = 0;

  const openStream = () => {
    const exists = fs.existsSync(filePath);
    currentSize = exists ? fs.statSync(filePath).size : 0;
    stream = fs.createWriteStream(filePath, { flags: 'a' });
  };

  const rotate = () => {
    if (stream) {
      stream.end();
      stream = null;
    }
    if (fs.existsSync(filePath)) {
      const rotated = path.join(logDir, `litepin-${formatTimestamp(new Date())}.log`);
      try {
        fs.renameSync(filePath, rotated);
      } catch {
        // Best-effort rotation.
      }
    }
    openStream();
  };

  openStream();

  return {
    write: (chunk: string) => {
      const data = Buffer.from(chunk);
      if (currentSize + data.length > maxSize) {
        rotate();
        currentSize = 0;
      }
      stream?.write(data);
      currentSize += data.length;
    }
  };
};

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime
  },
  multistream([{ stream: process.stdout }, { stream: createRotatingStream(logFile, maxBytes) }])
);

export default logger;
export const getLogDir = () => logDir;
export const getLogFile = () => logFile;
