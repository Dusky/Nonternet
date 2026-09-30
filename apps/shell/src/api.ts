import { en } from '@app/strings';

// Errors from the API are { error: { code, message } } (docs/14). The message is already plain
// and says what to do next, so screens can show it as it is.
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', en['error.network']);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'unknown', data?.error?.message ?? en['error.generic']);
  return data as T;
}

// Sends a file as the whole request body (the homepage studio, file areas).
async function upload<T = void>(path: string, file: Blob | string, method: 'PUT' | 'POST' = 'PUT'): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream' }, body: file });
  } catch {
    throw new ApiError(0, 'network', en['error.network']);
  }
  if (res.status === 204) return undefined as T;
  if (res.ok) return (await res.json().catch(() => undefined)) as T;
  const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  throw new ApiError(res.status, data?.error?.code ?? 'unknown', data?.error?.message ?? en['error.generic']);
}

export const api = {
  upload,
  get: <T>(path: string) => request<T>('GET', path),
  post: <T = void>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T = void>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T = void>(path: string, body?: unknown) => request<T>('DELETE', path, body ?? {}),
};
