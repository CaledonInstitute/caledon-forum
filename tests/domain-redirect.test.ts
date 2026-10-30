import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@astrojs/cloudflare/handler", () => ({ handle: vi.fn(() => new Response("forum")) }));
vi.mock("../src/lib/push", () => ({ consumePush: vi.fn() }));
vi.mock("../src/lib/control", () => ({ control: vi.fn() }));
vi.mock("../src/worker/control", () => ({ ForumControl: class {} }));
vi.mock("../src/worker/pages", () => ({ ForumPages: class {} }));

import { handle } from "@astrojs/cloudflare/handler";
import { env } from "./runtime";
import worker from "../src/worker";

beforeEach(() => {
  vi.clearAllMocks();
  env.SERVER_DO_ENABLED = "false";
});

it.each(["/", "/p/123?sort=latest&tag=a%2Fb", "//example.com/path", "/api/auth/callback/github?code=test&state=123"])(
  "redirects the old domain before dispatch while preserving %s",
  async (path) => {
    env.SERVER_DO_ENABLED = "true";
    const response = await worker.fetch(new Request(`https://caledon-forum.supervoid.workers.dev${path}`), {} as Env, {} as ExecutionContext);
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe(`https://forum.hengker.tech${path}`);
    expect(handle).not.toHaveBeenCalled();
  }
);

it.each(["http://localhost:4321", "http://127.0.0.1:4321", "http://[::1]:4321", "https://forum.hengker.tech"])("serves %s without a domain redirect", async (origin) => {
  const response = await worker.fetch(new Request(`${origin}/`), {} as Env, {} as ExecutionContext);
  expect(response.status).toBe(200);
  expect(response.headers.has("Location")).toBe(false);
  expect(handle).toHaveBeenCalledOnce();
});

it("preserves POST methods with a permanent 308 redirect", async () => {
  const response = await worker.fetch(
    new Request("https://caledon-forum.supervoid.workers.dev/api/forum/publish", { method: "POST", body: "test" }),
    {} as Env,
    {} as ExecutionContext
  );
  expect(response.status).toBe(308);
  expect(response.headers.get("Location")).toBe("https://forum.hengker.tech/api/forum/publish");
  expect(handle).not.toHaveBeenCalled();
});
