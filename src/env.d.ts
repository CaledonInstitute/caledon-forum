/// <reference types="astro/client" />
declare namespace App {
  interface Locals {
    user: import("./lib/types").Viewer | null;
    sessionId?: string;
  }
}
declare namespace Cloudflare {
  interface Env {
    STATIC_OG_ENABLED?: string;
    POST_OG_ENABLED?: string;
    PROFILE_OG_ENABLED?: string;
    REALTIME_ENABLED?: string;
    PRESENCE_ENABLED?: string;
    PUSH_ENABLED?: string;
    RATE_LIMIT_DO_ENABLED?: string;
    FORUM_CONTROL?: DurableObjectNamespace;
    PUBLIC_METADATA?: KVNamespace;
    PUSH_QUEUE?: Queue;
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
    WEB_ANALYTICS_TOKEN?: string;
    SERVER_DO_ENABLED?: string;
    FORUM_PAGES?: DurableObjectNamespace;
    BETTER_AUTH_SECRET?: string;
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    RESEND_API_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
    SEARCH_CONSOLE_TOKEN?: string;
  }
}
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
declare module "*.wasm?module" {
  const module: WebAssembly.Module;
  export default module;
}
declare module "*.woff?inline" {
  const data: string;
  export default data;
}
declare module "*satori-worker.mjs" {
  export { default, init } from "satori/standalone";
}
declare module "*.sql" {
  const sql: string;
  export default sql;
}
