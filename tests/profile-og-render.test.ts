import { beforeEach, it, expect, vi } from "vitest";
import { env } from "./runtime";
import { cardImage, type ProfileCardData } from "../src/lib/og-card";
import { profileSocialSvg } from "../src/lib/og";
import { renderProfileCard } from "../src/lib/og-render";
vi.mock("@resvg/resvg-wasm/index_bg.wasm?module", () => ({ default: {} }));
vi.mock("@fontsource/manrope/files/manrope-latin-400-normal.woff?inline", () => ({ default: "data:font/woff;base64,AA==" }));
vi.mock("@fontsource/manrope/files/manrope-latin-700-normal.woff?inline", () => ({ default: "data:font/woff;base64,AA==" }));
vi.mock("../src/lib/og", () => ({ socialSvg: vi.fn(), profileSocialSvg: vi.fn() }));
vi.mock("../src/lib/og-card", async (original) => ({ ...(await original<typeof import("../src/lib/og-card")>()), cardImage: vi.fn() }));
const resources = vi.hoisted(() => ({ freeRenderer: vi.fn(), freeImage: vi.fn() }));
vi.mock("@resvg/resvg-wasm", () => ({
  initWasm: vi.fn(async () => {}),
  Resvg: class {
    constructor(svg: string) {
      if (svg === "bad-image") throw new Error("Decoder failed");
    }
    render() {
      return { asPng: () => Uint8Array.of(1, 2, 3), free: resources.freeImage };
    }
    free = resources.freeRenderer;
  },
}));
const data: ProfileCardData = {
  name: "Alice",
  username: "alice",
  bio: "Hello",
  avatar: "https://public.com/a.png",
  cover: "https://public.com/c.png",
  member: true,
  host: "forum.public.com",
};
beforeEach(() => {
  vi.clearAllMocks();
  env.ASSETS = { fetch: vi.fn(async () => new Response(Uint8Array.of(0))) };
  vi.mocked(cardImage).mockResolvedValue(undefined);
  vi.mocked(profileSocialSvg).mockResolvedValue("svg");
});
it("downloads both images with the same deadline and 2 MB limits, then releases raster resources", async () => {
  vi.mocked(cardImage).mockResolvedValueOnce("avatar").mockResolvedValueOnce("cover");
  expect(await renderProfileCard(data)).toEqual(Uint8Array.of(1, 2, 3));
  const calls = vi.mocked(cardImage).mock.calls;
  expect(calls.map(([url, max]) => [url, max])).toEqual([
    [data.avatar, 2 * 1024 * 1024],
    [data.cover, 2 * 1024 * 1024],
  ]);
  expect(calls[0][2]).toBe(calls[1][2]);
  expect(profileSocialSvg).toHaveBeenCalledWith(expect.anything(), data, "avatar", "cover");
  expect(resources.freeImage).toHaveBeenCalledOnce();
  expect(resources.freeRenderer).toHaveBeenCalledOnce();
});
it("renders missing or unavailable images with initials and a neutral cover", async () => {
  await renderProfileCard({ ...data, avatar: null, cover: null });
  expect(profileSocialSvg).toHaveBeenCalledWith(expect.anything(), { ...data, avatar: null, cover: null }, undefined, undefined);
});
it("retries without external images if the raster decoder fails", async () => {
  vi.mocked(cardImage).mockResolvedValue("image-data");
  vi.mocked(profileSocialSvg).mockResolvedValueOnce("bad-image").mockResolvedValueOnce("svg");
  expect(await renderProfileCard(data)).toEqual(Uint8Array.of(1, 2, 3));
  expect(profileSocialSvg).toHaveBeenCalledTimes(2);
  expect(vi.mocked(profileSocialSvg).mock.calls[1]).toEqual([expect.anything(), data]);
});
it("propagates failures when rendering without images already failed", async () => {
  vi.mocked(profileSocialSvg).mockRejectedValue(new Error("Layout failed"));
  await expect(renderProfileCard(data)).rejects.toThrow("Layout failed");
  expect(profileSocialSvg).toHaveBeenCalledOnce();
});
