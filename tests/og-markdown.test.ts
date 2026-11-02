import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { cardMarkdown } from "../src/lib/og-markdown";
import { postCardData } from "../src/lib/og-card";
import { socialSvg, storySvg } from "../src/lib/og";
import type { ForumPost } from "../src/lib/types";

vi.mock("satori/layout.wasm?module", () => ({ default: {} }));
vi.mock("../.astro/satori-worker.mjs", async () => ({ default: (await import("satori")).default, init: async () => {} }));

function flatten(value: any): any[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(flatten);
  return typeof value === "object" ? [value, ...flatten(value.props?.children)] : [value];
}

it("preserves inline formatting, paragraphs, code punctuation and numbered lists", () => {
  const { content } = cardMarkdown(
    "# Heading\n\n**Bold** *italic* ~~deleted~~ [link](https://example.com)\n\n3. First\n4. Second\n\n```js\nconst snake_case = a > b;\n  next();\n```",
    1400,
    32
  );
  const nodes = flatten(content);
  expect(nodes).toContain("Bold");
  expect(nodes.some((n) => n.props?.style.fontWeight === 700)).toBe(true);
  expect(nodes.some((n) => n.props?.style.fontStyle === "italic")).toBe(true);
  expect(nodes.some((n) => n.props?.style.textDecoration === "line-through")).toBe(true);
  expect(nodes.some((n) => n.props?.style.color === "#1d70e8")).toBe(true);
  expect(nodes).toContain("3.");
  expect(nodes).toContain("4.");
  expect(nodes).toContain("const snake_case = a > b;\n  next();\n");
  expect(nodes).not.toContain("**Bold**");
});

it("sanitizes HTML, excludes remote images, and truncates text without breaking formatting", () => {
  const { content, truncated } = cardMarkdown('<script>bad()</script><b onclick="bad()">Hello</b> **😀😀😀😀😀😀😀😀**\n\n![image](https://private.invalid/image)', 10, 32);
  const serialized = JSON.stringify(content);
  expect(serialized).not.toMatch(/bad\(|onclick|private.invalid|<script>/);
  expect(serialized).toContain("…");
  expect(truncated).toBe(true);
  expect(serialized).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
});

it("preserves symbol-only code and task state, and omits only the selected media URL", () => {
  const nodes = flatten(
    cardMarkdown("```\n_ > ~\n```\n\n- [x] Done\n- [ ] Next\n\nhttps://example.com/image\n\n[Reference](https://example.com/image)", 1400, 32, "https://example.com/image").content
  );
  expect(nodes).toContain("_ > ~\n");
  expect(nodes).toContain("[x] ");
  expect(nodes).toContain("[ ] ");
  expect(nodes).toContain("Reference");
  expect(nodes).not.toContain("https://example.com/image");
  expect(cardMarkdown("```\n_ > ~\n```", 1400, 32).hasContent).toBe(true);
});

it("keeps source Markdown in the card data and renders actual SVGs in both export sizes", async () => {
  const body = "# Heading\n\n**Bold** and *italic* with `snake_case`.\n\n- One\n- Two\n\n> Quote\n\n```js\nconst x = a > b;\n```\n\n| Column | Value |\n|---|---|\n| A | B |";
  const data = postCardData({ publicId: "123", name: "Alice", username: "alice", body, createdAt: 1793606880000, updatedAt: 1 } as ForumPost, [], "https://forum.example.com");
  expect(data.markdown).toBe(body);
  const regular = await readFile("node_modules/@fontsource/manrope/files/manrope-latin-400-normal.woff");
  const bold = await readFile("node_modules/@fontsource/manrope/files/manrope-latin-700-normal.woff");
  const fonts = { regular, bold, emoji: regular } as any;
  for (const [render, width, height] of [
    [socialSvg, 1200, 630],
    [storySvg, 1080, 1920],
  ] as const) {
    const svg = await render(fonts, data);
    expect(svg).toContain(`width="${width}" height="${height}"`);
    expect(svg).toContain("<path");
    const plain = await render(fonts, { ...data, markdown: data.text });
    expect(svg).not.toBe(plain);
  }
});
