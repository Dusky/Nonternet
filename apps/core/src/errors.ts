// API errors are { error: { code, message } } (docs/14). Messages are plain and say what to do next.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
