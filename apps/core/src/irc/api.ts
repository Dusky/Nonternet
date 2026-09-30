import type { IrcDeps } from './secrets';

// Ergo's HTTP API (VERIFIED against ergo 2.19.1 docs/API.md): every call is a POST with a bearer token.
export async function ergoApi<T = Record<string, unknown>>(irc: IrcDeps, path: string, body: object = {}): Promise<T> {
  const res = await fetch(`${irc.apiUrl}/v1/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${irc.secrets.apiToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`ergo api ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface ErgoStatus { success: boolean; version: string; start_time: string; users: { total: number; invisible: number; operators: number; unknown: number; max: number }; channels: number }
export interface ErgoChannel { name: string; userCount: number; topic: string; registered: boolean; owner?: string; hasKey: boolean; inviteOnly: boolean; secret: boolean }

export const ergoStatus = (irc: IrcDeps) => ergoApi<ErgoStatus>(irc, 'status');
export const ergoChannels = async (irc: IrcDeps) => (await ergoApi<{ channels: ErgoChannel[] }>(irc, 'list')).channels ?? [];
