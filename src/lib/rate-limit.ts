import { one, run } from "./db";
export async function rateLimit(key: string, limit: number, windowMs = 60000) {
  const now = Date.now();
  const result = await one<{ count: number }>(
    `INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING count`,
    key,
    now + windowMs,
    now,
    now
  );
  if ((result?.count || 0) > limit)
    throw new Response(JSON.stringify({ error: "Too many requests. Try again shortly." }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": String(Math.ceil(windowMs / 1000)) },
    });
  if (Math.random() < 0.01) await run("DELETE FROM rate_limits WHERE reset_at<?", now);
}
