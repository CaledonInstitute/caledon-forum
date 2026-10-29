/// <reference types="astro/client" />
declare namespace App {
  interface Locals { user: import('./lib/types').Viewer | null; }
}
declare namespace Cloudflare {
  interface Env {
    BETTER_AUTH_SECRET?: string;
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
    RESEND_API_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
    SEARCH_CONSOLE_TOKEN?: string;
  }
}
declare module '*.wasm' { const module: WebAssembly.Module; export default module; }
declare module '*.wasm?module' { const module: WebAssembly.Module; export default module; }
declare module '*.woff?inline' { const data: string; export default data; }
declare module '*satori-worker.mjs' { export { default,init } from 'satori/standalone'; }
declare module '*.sql' { const sql:string; export default sql; }
