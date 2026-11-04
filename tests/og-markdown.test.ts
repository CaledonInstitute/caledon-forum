import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
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

function png(width: number, height: number) {
  function chunk(type: string, bytes: Buffer) {
    const data = Buffer.concat([Buffer.from(type), bytes]);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4),
      tail = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length);
    tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, data, tail]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height, 190);
  for (let row = 0; row < height; row++) pixels[row * (width * 3 + 1)] = 0;
  return (
    "data:image/png;base64," +
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]).toString("base64")
  );
}
it("exports full-width uncropped portrait and landscape images with flexible height and a safe upper bound", async () => {
  const regular = await readFile("node_modules/@fontsource/manrope/files/manrope-latin-400-normal.woff");
  const bold = await readFile("node_modules/@fontsource/manrope/files/manrope-latin-700-normal.woff");
  const italic = await readFile("node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-italic.woff");
  const fonts = { regular, bold, italic, emoji: regular } as any;
  const data = postCardData(
    { publicId: "123", name: "Alice", username: "alice", body: "*Photo caption*", createdAt: 1, updatedAt: 1 } as ForumPost,
    [],
    "https://forum.example.com"
  );
  for (const [width, height] of [
    [3, 7],
    [7, 3],
  ]) {
    const svg = await storySvg(fonts, data, undefined, png(width, height));
    const image = svg.match(/<image\b[^>]*>/g)?.find((tag) => tag.includes('width="1080"'));
    expect(image).toBeDefined();
    expect(Number(/height="([0-9.]+)"/.exec(image!)?.[1])).toBeCloseTo((1080 * height) / width, 0);
    expect(Number(/<svg[^>]*height="(\d+)"/.exec(svg)?.[1])).toBeGreaterThan(Math.ceil((1080 * height) / width));
  }
  await expect(storySvg(fonts, data, undefined, png(1, 100))).rejects.toThrow("too tall");
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
    [storySvg, 1080, 0],
  ] as const) {
    const svg = await render(fonts, data);
    if (height) expect(svg).toContain(`width="${width}" height="${height}"`);
    else {
      expect(svg).toContain(`width="1080"`);
      expect(Number(/height="(\d+)"/.exec(svg)?.[1])).toBeGreaterThanOrEqual(900);
    }
    expect(svg).toContain("<path");
    const plain = await render(fonts, { ...data, markdown: data.text });
    expect(svg).not.toBe(plain);
  }
});
