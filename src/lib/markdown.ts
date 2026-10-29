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
  const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw);
  const ast = parser.runSync(parser.parse(body));
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
export async function markdown(body: string, previews: LinkPreview[] = [], quoteSource?: string): Promise<string> {
  const images = new Map(previews.filter((p) => p.kind === "image").map((p) => [p.url, p]));
  const imageFor = (value: string) => {
    try {
      const url = new URL(value);
      url.hash = "";
      return images.get(url.href);
    } catch {
      return undefined;
    }
  };
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(() => (tree: any) => {
      visit(tree, (node: any, index: number | undefined, parent: any) => {
        if (!parent || index === undefined) return;
        if (node.type === "image") {
          const image = imageFor(node.url);
          if (image) node.url = `/api/media/${image.id}`;
          else parent.children[index] = { type: "text", value: node.alt || "Image unavailable" };
        }
        if (node.type === "link" && parent.type === "paragraph" && node.children?.length === 1 && node.children[0]?.value === node.url) {
          const image = imageFor(node.url);
          if (image) parent.children[index] = { type: "image", url: `/api/media/${image.id}`, alt: "External image", title: null };
        }
      });
    })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(() => (tree: any) => {
      const proxyUrls = new Set([...images.values()].map((image) => `/api/media/${image.id}`));
      visit(tree, "element", (node: any, index: number | undefined, parent: any) => {
        if (node.tagName !== "img") return;
        const src = String(node.properties.src || "");
        if (proxyUrls.has(src)) return;
        const image = imageFor(src);
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
    .use(() => (tree: any) => {
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
    .use(rehypeStringify);
  return String(await processor.process(body));
}
