import { en } from '@app/strings';

// Errors from the API are { error: { code, message } } (docs/14). The message is already plain
// and says what to do next, so screens can show it as it is.
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

// Told when a request is refused because the session is gone (a 401 anywhere once signed in), so the shell can
// say so and offer the way back in without throwing away what someone was writing. The login calls themselves
// answer 401 for a wrong password; those are not "expired".
const expiredListeners = new Set<() => void>();
export const onSessionExpired = (fn: () => void): (() => void) => { expiredListeners.add(fn); return () => { expiredListeners.delete(fn); }; };
const notAboutSession = /^\/(auth\/|me$)/;
function expired(path: string, status: number) { if (status === 401 && !notAboutSession.test(path)) for (const fn of expiredListeners) fn(); }

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
  if (!res.ok) { expired(path, res.status); throw new ApiError(res.status, data?.error?.code ?? 'unknown', data?.error?.message ?? en['error.generic']); }
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
  expired(path, res.status);
  throw new ApiError(res.status, data?.error?.code ?? 'unknown', data?.error?.message ?? en['error.generic']);
}

// The same, but reports how much has gone (fetch can't), so a big file shows a bar instead of a frozen button.
function uploadWithProgress<T = void>(path: string, file: Blob, onProgress: (fraction: number) => void, method: 'PUT' | 'POST' = 'POST'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, `/api/v1${path}`);
    x.withCredentials = true;
    x.setRequestHeader('content-type', 'application/octet-stream');
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onerror = () => reject(new ApiError(0, 'network', en['error.network']));
    x.onload = () => {
      if (x.status === 204) return resolve(undefined as T);
      type Body = { error?: { code?: string; message?: string } } | null;
      let data = null as Body;
      try { data = JSON.parse(x.responseText) as Body; } catch { /* not JSON */ }
      if (x.status >= 200 && x.status < 300) return resolve(data as T);
      expired(path, x.status);
      reject(new ApiError(x.status, data?.error?.code ?? 'unknown', data?.error?.message ?? en['error.generic']));
    };
    x.send(file);
  });
}

export const api = {
  upload,
  uploadWithProgress,
  get: <T>(path: string) => request<T>('GET', path),
  post: <T = void>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T = void>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T = void>(path: string, body?: unknown) => request<T>('DELETE', path, body ?? {}),
};
