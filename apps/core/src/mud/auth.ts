import type { AppDeps } from '../deps';
import { checkTerminalLogin } from '../irc/auth';

export interface MudAuthResult { success: boolean; accountName?: string; user_id?: string; role?: string; builder?: boolean; error?: string }

// The MUD's login backend asks this for every `connect` (docs/09). Besides yes or no it learns who the
// person is by stable id, their site role and whether an admin made them a builder.
export async function checkMudLogin(deps: AppDeps, accountName: unknown, passphrase: unknown): Promise<MudAuthResult> {
  const r = await checkTerminalLogin(deps, 'mud', accountName, passphrase);
  if (!r.ok) return { success: false, error: r.error };
  return { success: true, accountName: r.user.handle, user_id: r.user.id, role: r.user.role, builder: await isBuilder(deps, r.user.id) };
}

export async function isBuilder(deps: AppDeps, userId: string): Promise<boolean> {
  const b = await deps.db.query(`SELECT 1 FROM scoped_roles WHERE user_id = $1 AND role = 'mud_builder' AND scope_type = 'mud'`, [userId]);
  return (b.rowCount ?? 0) > 0;
}
