export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const isAppError = (value: unknown): value is AppError => value instanceof AppError;

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Unauthorized') => new AppError(401, 'unauthorized', message);
export const notFound = (message = 'Not found') => new AppError(404, 'not_found', message);
export const badGateway = (message: string, details?: unknown) => new AppError(502, 'bad_gateway', message, details);
