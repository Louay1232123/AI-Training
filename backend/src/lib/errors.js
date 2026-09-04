/** An error carrying an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) =>
  new ApiError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Admin password required or incorrect.') =>
  new ApiError(401, 'unauthorized', message);
export const notFound = (message = 'Not found.') => new ApiError(404, 'not_found', message);
export const conflict = (code, message, details) => new ApiError(409, code, message, details);
export const tooManyRequests = (message, details) =>
  new ApiError(429, 'rate_limited', message, details);
