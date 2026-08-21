import { env } from "cloudflare:workers";
import postgres, { type Sql } from "postgres";

type Row = Record<string, unknown>;
type QueryExecutor = Pick<Sql, "unsafe">;

export type TransactionDatabase = {
  prepare(source: string): PreparedPostgresQuery;
  batch(queries: PreparedPostgresQuery[]): Promise<unknown[][]>;
};

function connectionString() {
  const workerUrl = (env as unknown as { DATABASE_URL?: string }).DATABASE_URL;
  const nodeUrl = typeof process !== "undefined" ? process.env.DATABASE_URL : undefined;
  const value = workerUrl || nodeUrl;
  if (!value) {
    throw new Error(
      "PostgreSQL is not configured. Set DATABASE_URL in .dev.vars locally and in the hosted environment."
    );
  }
  return value;
}

function postgresSql(source: string) {
  let query = source.trim().replace(/;$/, "");
  const ignoreConflicts = /INSERT\s+OR\s+IGNORE\s+INTO/i.test(query);
  query = query.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, "INSERT INTO");
  if (ignoreConflicts && !/\bON\s+CONFLICT\b/i.test(query)) {
    const returning = query.match(/\s+RETURNING\s+[\s\S]+$/i);
    if (returning?.index !== undefined) {
      query = `${query.slice(0, returning.index)} ON CONFLICT DO NOTHING${returning[0]}`;
    } else {
      query += " ON CONFLICT DO NOTHING";
    }
  }

  let index = 0;
  return query.replace(/\?/g, () => `$${++index}`);
}

export class PreparedPostgresQuery {
  private values: unknown[] = [];

  constructor(private readonly executor: Sql, private readonly source: string) {}

  bind(...values: unknown[]) {
    const bound = new PreparedPostgresQuery(this.executor, this.source);
    bound.values = values;
    return bound;
  }

  async execute(executor: QueryExecutor = this.executor) {
    return executor.unsafe(postgresSql(this.source), this.values as never[]) as Promise<Row[]>;
  }

  async first<T extends Row>() {
    const rows = await this.execute();
    return (rows[0] as T | undefined) ?? null;
  }

  async all<T extends Row = Row>() {
    const rows = await this.execute();
    return { results: rows as T[] };
  }

  async run() {
    const rows = await this.execute();
    return { results: rows };
  }
}

export function createDatabase() {
  const url = connectionString();
  const isLocal = /(?:localhost|127\.0\.0\.1|\[::1\])/.test(url);
  const client = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    ssl: isLocal ? false : "require",
  });

  return {
    prepare(source: string) {
      return new PreparedPostgresQuery(client, source);
    },
    async batch(queries: PreparedPostgresQuery[]) {
      return client.begin(async (transaction) => {
        const results = [];
        for (const query of queries) results.push(await query.execute(transaction));
        return results;
      });
    },
    async transaction<T>(callback: (database: TransactionDatabase) => Promise<T>) {
      return client.begin(async transaction => {
        const database: TransactionDatabase = {
          prepare(source: string) {
            return new PreparedPostgresQuery(transaction as unknown as Sql, source);
          },
          async batch(queries: PreparedPostgresQuery[]) {
            const results = [];
            for (const query of queries) results.push(await query.execute(transaction));
            return results;
          },
        };
        return callback(database);
      });
    },
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}

export type PostgresDatabase = ReturnType<typeof createDatabase>;
