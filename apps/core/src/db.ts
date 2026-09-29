import pg from 'pg';

// The smallest surface the rest of core needs. Plain SQL, no ORM (boring core).
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number }>;
}
export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

export function connect(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // Without a listener, an idle connection dropped by the server (a Postgres restart, a failover)
  // would crash the whole process. Log it and let the pool open a fresh connection.
  let closing = false;
  pool.on('error', (err) => {
    if (!closing) console.error(`Postgres connection error: ${err.message}`);
  });
  const wrap = (c: pg.Pool | pg.PoolClient): Queryable => ({
    async query(text, params) {
      const r = await c.query(text, params as unknown[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
  });
  return {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    end: () => { closing = true; return pool.end(); },
  };
}

export const isUniqueViolation = (err: unknown, constraint?: string): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505' &&
  (constraint === undefined || (err as { constraint?: string }).constraint === constraint);
