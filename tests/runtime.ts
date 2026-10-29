import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
let sqlite: DatabaseSync;
class Statement {
  constructor(
    private sql: string,
    private args: any[] = []
  ) {}
  bind(...args: any[]) {
    return new Statement(this.sql, args);
  }
  async all() {
    return { success: true, results: sqlite.prepare(this.sql).all(...this.args), meta: { changes: 0 } };
  }
  async first(column?: string) {
    const row = sqlite.prepare(this.sql).get(...this.args) as any;
    return column ? row?.[column] : row || null;
  }
  async raw() {
    const stmt = sqlite.prepare(this.sql);
    stmt.setReturnArrays(true);
    return stmt.all(...this.args);
  }
  async run() {
    const result = sqlite.prepare(this.sql).run(...this.args);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
}
export const env: any = {
  SITE_URL: "http://localhost:4321",
  AUTH_ENABLED: "false",
  BETTER_AUTH_SECRET: "test-secret-only-012345678901234567890123456789",
  GITHUB_CLIENT_ID: "test",
  GITHUB_CLIENT_SECRET: "test",
  RESEND_API_KEY: "test",
  EMAIL_FROM: "Caledon <test@caledon.test>",
  TURNSTILE_SITE_KEY: "test",
  DB: {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      sqlite.exec("BEGIN");
      try {
        const result = [];
        for (const s of statements) result.push(await s.run());
        sqlite.exec("COMMIT");
        return result;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  },
};
export function resetDatabase() {
  sqlite?.close();
  sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(new URL("../migrations/", import.meta.url))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
}
export function execute(sql: string, ...args: any[]) {
  return sqlite.prepare(sql).run(...args);
}
export function row(sql: string, ...args: any[]) {
  return sqlite.prepare(sql).get(...args) as any;
}
export function randomSequence(values: number[]) {
  let i = 0;
  sqlite.function("random", () => BigInt(values[i++] ?? 1));
}
export function seedUser(id = "alice", verified = true, role = "user") {
  execute(
    "INSERT INTO user(id,name,email,email_verified,created_at,updated_at,username,role) VALUES(?,?,?,?,?,?,?,?)",
    id,
    id,
    `${id}@mail.test`,
    verified ? 1 : 0,
    Date.now(),
    Date.now(),
    id,
    role
  );
  return { id, name: id, username: id, emailVerified: verified, image: null, coverImage: null, bio: "", location: "", role, suspended: false };
}
