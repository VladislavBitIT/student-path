export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function assertFound<T>(value: T | null | undefined, code = 'NOT_FOUND', message = 'Ресурс не найден'): T {
  if (value === null || value === undefined) throw new AppError(404, code, message);
  return value;
}
