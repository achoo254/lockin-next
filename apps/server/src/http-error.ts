/** An error with the HTTP status and stable error code the API answers with ({ error: code }). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'HttpError';
  }
}
