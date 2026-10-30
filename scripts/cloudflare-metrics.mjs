// Read-only diagnostics. Never print credentials, headers, query strings, or bodies.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const account = "b8f317159c1f46327da0722f13b19256";
const config = await readFile(join(process.env.APPDATA, "xdg.config/.wrangler/config/default.toml"), "utf8");
const token = process.env.CLOUDFLARE_API_TOKEN || /oauth_token\s*=\s*"([^"]+)"/.exec(config)?.[1];
if (!token) throw new Error("Run wrangler login before collecting diagnostics.");
const start = new Date(Date.now() - 24 * 3600000).toISOString();
const end = new Date().toISOString();
const query = `query { viewer { accounts(filter: {accountTag: "${account}"}) {
  workersInvocationsAdaptive(limit: 100, filter: {scriptName: "caledon-forum", datetime_geq: "${start}", datetime_leq: "${end}"}) {
    dimensions { status }
    sum { requests errors subrequests }
    quantiles { cpuTimeP50 cpuTimeP99 wallTimeP50 wallTimeP99 }
  }
} } }`;
const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
const result = await response.json();
console.log(JSON.stringify({ period: { start, end }, httpStatus: response.status, ...result }, null, 2));
const subscriptions = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/subscriptions`, { headers: { Authorization: `Bearer ${token}` } });
const plans = await subscriptions.json();
console.log(
  JSON.stringify(
    {
      subscriptionStatus: subscriptions.status,
      subscriptions: plans.result?.map((s) => ({ state: s.state, plan: s.rate_plan?.id, name: s.rate_plan?.public_name })),
      errors: plans.errors?.map((e) => ({ code: e.code, message: e.message })),
    },
    null,
    2
  )
);
const analytics = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/rum/site_info/list`, { headers: { Authorization: `Bearer ${token}` } });
const sites = await analytics.json();
console.log(
  JSON.stringify(
    {
      webAnalyticsStatus: analytics.status,
      sites: sites.result?.map((s) => ({ site_tag: s.site_tag, host: s.ruleset?.zone_name, rules: s.rules?.map((r) => r.host) })),
      errors: sites.errors?.map((e) => ({ code: e.code, message: e.message })),
    },
    null,
    2
  )
);
