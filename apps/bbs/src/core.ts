// How the BBS talks to core (docs/04). Two kinds of call: private ones with the BBS's own token (sign a
// caller in, report nodes, log out), and ordinary API calls made as the caller, with the session core gave
// them. The second kind goes through exactly the same checks as the web.

export class CoreError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export interface LoginResult { token: string; call_id: string; user: { id: string; handle: string; role: string }; last_call_at: string | null }
export interface NodeReport { node: number; token: string; via: 'telnet' | 'ssh' | 'web'; where: string; since: string }
export type NodeAnswer = { node: number; ok: false } | { node: number; ok: true; user: { id: string; handle: string; role: string; role_rev: number } };

export class Core {
  constructor(private readonly base: string, private readonly bbsToken: string, private readonly origin: string) {}

  private async call<T>(method: string, path: string, opts: { body?: unknown; bearer?: string; session?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { origin: this.origin };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
    if (opts.session) headers.cookie = `sid=${opts.session}`;
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new CoreError(0, 'unreachable', 'The site is not answering right now. Try again in a minute.');
    }
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (!res.ok) throw new CoreError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? 'Something went wrong.');
    return data as T;
  }

  // ---- private (BBS token)
  login(b: { method: 'password' | 'ticket'; handle: string; secret: string; via: NodeReport['via']; node: number; ip_hash?: string | null }) {
    return this.call<LoginResult>('POST', '/internal/bbs/login', { body: b, bearer: this.bbsToken });
  }
  loginKey(b: { handle: string; fingerprint: string; node: number; ip_hash?: string | null }) {
    return this.call<LoginResult>('POST', '/internal/bbs/login-key', { body: b, bearer: this.bbsToken });
  }
  async hasKeys(handle: string): Promise<boolean> {
    return (await this.call<{ keys: boolean }>('POST', '/internal/bbs/has-keys', { body: { handle }, bearer: this.bbsToken })).keys;
  }
  logout(token: string, callId?: string) { return this.call<void>('POST', '/internal/bbs/logout', { body: { token, call_id: callId }, bearer: this.bbsToken }); }
  nodes(nodes: NodeReport[]) { return this.call<{ nodes: NodeAnswer[] }>('POST', '/internal/bbs/nodes', { body: { nodes }, bearer: this.bbsToken }); }

  // ---- as the caller (their session)
  as(session: string): UserApi {
    return {
      get: <T>(path: string) => this.call<T>('GET', `/api/v1${path}`, { session }),
      post: <T = void>(path: string, body: unknown = {}) => this.call<T>('POST', `/api/v1${path}`, { body, session }),
      put: <T = void>(path: string, body: unknown = {}) => this.call<T>('PUT', `/api/v1${path}`, { body, session }),
      del: <T = void>(path: string, body: unknown = {}) => this.call<T>('DELETE', `/api/v1${path}`, { body, session }),
    };
  }
  publicGet<T>(path: string) { return this.call<T>('GET', `/api/v1${path}`); }
}

export interface UserApi {
  get<T>(path: string): Promise<T>;
  post<T = void>(path: string, body?: unknown): Promise<T>;
  put<T = void>(path: string, body?: unknown): Promise<T>;
  del<T = void>(path: string, body?: unknown): Promise<T>;
}
