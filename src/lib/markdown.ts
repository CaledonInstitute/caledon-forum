import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type { LinkPreview } from "./types";
import { transformMentions } from "./mentions";
export function extractLinks(body: string, includeImages = true): string[] {
  const ast = linkParser.runSync(linkParser.parse(body));
  const urls = new Set<string>();
  function walk(node: any) {
    if (["pre", "code"].includes(node.tagName)) return;
    const value = node.tagName === "a" ? node.properties.href : includeImages && node.tagName === "img" ? node.properties.src : undefined;
    if (typeof value === "string") urls.add(value);
    node.children?.forEach(walk);
  }
  walk(ast);
  return [...urls].slice(0, 8);
}
export function extractUrls(body: string): string[] {
  return extractLinks(body).filter((url) => /^https:\/\//.test(url));
}
const linkParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).freeze();
type RenderData = { images: Map<string, LinkPreview>; quoteSource?: string; limit?: number };
function imageFor(images: RenderData["images"], value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return images.get(url.href);
  } catch {
    return undefined;
  }
}
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(() => (tree: any, file: any) => {
    const { images } = file.data as RenderData;
    visit(tree, (node: any, index: number | undefined, parent: any) => {
      if (!parent || index === undefined) return;
      if (node.type === "image") {
        const image = imageFor(images, node.url);
        if (image) node.url = `/api/media/${image.id}`;
        else parent.children[index] = { type: "text", value: node.alt || "Image unavailable" };
      }
      if (node.type === "link" && parent.type === "paragraph" && node.children?.length === 1 && node.children[0]?.value === node.url) {
        const image = imageFor(images, node.url);
        if (image) parent.children[index] = { type: "image", url: `/api/media/${image.id}`, alt: "External image", title: null };
      }
    });
  })
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(() => (tree: any, file: any) => {
    const { images } = file.data as RenderData;
    const proxyUrls = new Set([...images.values()].map((image) => `/api/media/${image.id}`));
    visit(tree, "element", (node: any, index: number | undefined, parent: any) => {
      if (node.tagName !== "img") return;
      const src = String(node.properties.src || "");
      if (proxyUrls.has(src)) return;
      const image = imageFor(images, src);
      if (image) node.properties.src = `/api/media/${image.id}`;
      else if (parent && index !== undefined) parent.children[index] = { type: "text", value: String(node.properties.alt || "Image unavailable") };
    });
  })
  .use(rehypeSanitize, {
    ...defaultSchema,
    attributes: {
      ...defaultSchema.attributes,
      code: [["className", /^language-[\w-]+$/, "math-inline", "math-display"]],
      img: ["src", "alt", "title", "loading", "decoding", "width", "height"],
      a: ["href", "title", "rel", "target"],
    },
  })
  .use(() => (tree: any) => transformMentions(tree))
  .use(() => (tree: any, file: any) => {
    const { quoteSource } = file.data as RenderData;
    if (!quoteSource) return;
    visit(tree, "element", (node: any, index: number | undefined, parent: any) => {
      if (
        node.tagName === "a" &&
        node.properties.href === quoteSource &&
        node.children?.length === 1 &&
        node.children[0].type === "text" &&
        node.children[0].value === quoteSource &&
        parent &&
        index !== undefined
      ) {
        parent.children[index] = { type: "text", value: "" };
      }
    });
  })
  .use(() => (tree: any, file: any) => {
    let remaining = (file.data as RenderData).limit;
    if (remaining === undefined) return;
    const textLength = (node: any): number =>
      node.type === "text" ? Array.from(node.value as string).length : (node.children || []).reduce((n: number, c: any) => n + textLength(c), 0);
    if (textLength(tree) > remaining) remaining = Math.max(0, remaining - 1);
    let truncated = false;
    function prune(parent: any) {
      const kept: any[] = [];
      for (const node of parent.children || []) {
        const math = node.properties?.className?.some((c: string) => c === "math-inline" || c === "math-display");
        if (math) {
          const value = node.children?.map((n: any) => n.value || "").join("") || "";
          if (Array.from(value).length > remaining!) {
            truncated = true;
            remaining = 0;
            break;
          }
          remaining! -= Array.from(value).length;
          kept.push(node);
          continue;
        }
        if (node.type === "text") {
          const chars = Array.from(node.value as string);
          if (chars.length > remaining!) {
            kept.push({ ...node, value: chars.slice(0, remaining).join("") });
            remaining = 0;
            truncated = true;
            break;
          }
          remaining! -= chars.length;
          kept.push(node);
        } else {
          if (remaining! <= 0) {
            truncated = true;
            break;
          }
          if (node.children) prune(node);
          kept.push(node);
          if (truncated) break;
        }
      }
      parent.children = kept;
    }
    prune(tree);
    if (truncated)
      tree.children.push({ type: "element", tagName: "span", properties: { dataContentTruncated: "true", ariaHidden: "true" }, children: [{ type: "text", value: "…" }] });
  })
  .use(rehypeKatex, { trust: false, strict: "ignore", maxExpand: 1000, maxSize: 20 })
  .use(rehypeHighlight, { detect: false, ignoreMissing: true })
  .use(() => (tree: any) => {
    visit(tree, "element", (node: any) => {
      if (node.tagName === "pre") {
        const code = node.children?.find((child: any) => child.tagName === "code");
        const language = code?.properties?.className?.find((name: string) => name.startsWith("language-"))?.slice(9);
        if (language) node.properties.dataLanguage = language;
      }
      if (node.tagName === "a") {
        node.properties.rel = ["ugc", "nofollow", "noopener"];
        if (!node.properties.className?.includes("mention")) node.properties.target = "_blank";
      }
      if (node.tagName === "img") {
        node.properties.loading = "lazy";
        node.properties.decoding = "async";
        node.properties.width = 600;
        node.properties.height = 360;
      }
    });
  })
  .use(rehypeStringify)
  .freeze();
export async function markdown(body: string, previews: LinkPreview[] = [], quoteSource?: string, limit?: number): Promise<string> {
  return String(await processor.process({ value: body, data: { images: new Map(previews.filter((p) => p.kind === "image").map((p) => [p.url, p])), quoteSource, limit } }));
}
