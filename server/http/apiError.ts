/**
 * The one error type routes throw.
 *
 * Carries a machine-readable `code` and a message that is safe to show a player, in
 * Japanese. Anything NOT thrown as an `ApiError` is an unexpected failure and is
 * reported as a generic 500 - an exception message, a stack trace or a SQL error must
 * never reach the client.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** Shown to the player. Never contains internal detail. */
    readonly publicMessage: string,
  ) {
    super(`${code}: ${publicMessage}`);
    this.name = 'ApiError';
  }

  static badRequest(code: string, message: string): ApiError {
    return new ApiError(400, code, message);
  }

  static notFound(code: string, message: string): ApiError {
    return new ApiError(404, code, message);
  }

  static conflict(code: string, message: string): ApiError {
    return new ApiError(409, code, message);
  }

  static gone(code: string, message: string): ApiError {
    return new ApiError(410, code, message);
  }

  static unprocessable(code: string, message: string): ApiError {
    return new ApiError(422, code, message);
  }

  static tooManyRequests(code: string, message: string): ApiError {
    return new ApiError(429, code, message);
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
