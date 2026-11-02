import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import type { ReactElement } from "react";

// Satori needs an explicit layout tree; browser HTML/CSS cannot be passed through.
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize).freeze();
type Tree = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: Tree[] };
const element = (type: string, style: Record<string, unknown>, children: unknown): ReactElement => ({ type, props: { style, children }, key: null }) as ReactElement;

export function cardMarkdown(source: string, limit: number, fontSize: number, omittedImage?: string) {
  const tree = parser.runSync(parser.parse(source)) as Tree;
  let remaining = limit;
  let truncated = false;
  function text(value: string) {
    const chars = Array.from(value);
    if (chars.length <= remaining) {
      remaining -= chars.length;
      return value;
    }
    const result =
      chars
        .slice(0, Math.max(0, remaining - 1))
        .join("")
        .trimEnd() + "…";
    remaining = 0;
    truncated = true;
    return result;
  }
  function render(node: Tree, inline = false, index = 0, ordered = false, start = 1): unknown {
    if (remaining <= 0) return null;
    if (node.type === "text") return text(node.value || "");
    const tag = node.tagName || "root";
    if (tag === "img") return null;
    if (tag === "input") return node.properties?.type === "checkbox" ? text(node.properties.checked ? "[x] " : "[ ] ") : null;
    if (tag === "a" && node.properties?.href === omittedImage && node.children?.[0]?.value === omittedImage) return null;
    if (tag === "br") return "\n";
    const children = (isInline: boolean) =>
      node.children
        ?.filter((child) => !["root", "ul", "ol", "table", "thead", "tbody", "tr"].includes(tag) || child.type !== "text" || !!child.value?.trim())
        .map((child, i) => render(child, isInline, i, tag === "ol", Number(node.properties?.start) || 1))
        .filter((child) => child !== null);
    if (tag === "root") return element("div", { display: "flex", flexDirection: "column", width: "100%", fontSize, lineHeight: 1.4 }, children(false));
    if (["strong", "b", "em", "i", "del", "s", "a", "code", "span"].includes(tag) && inline) {
      return element(
        "span",
        {
          ...(tag === "strong" || tag === "b" ? { fontWeight: 700 } : {}),
          ...(tag === "em" || tag === "i" ? { fontStyle: "italic" } : {}),
          ...(tag === "del" || tag === "s" ? { textDecoration: "line-through" } : {}),
          ...(tag === "a" ? { color: "#1d70e8", textDecoration: "underline" } : {}),
          ...(tag === "code" ? { background: "#f0f0f0", fontSize: fontSize * 0.9 } : {}),
        },
        children(true)
      );
    }
    if (tag === "pre") {
      const value = node.children?.map((child) => child.children?.map((part) => part.value || "").join("") || child.value || "").join("") || "";
      return element(
        "div",
        {
          display: "flex",
          whiteSpace: "pre-wrap",
          background: "#f7f7f7",
          border: "1px solid #e5e5e5",
          borderRadius: 8,
          padding: 16,
          fontSize: fontSize * 0.8,
          lineHeight: 1.35,
          marginBottom: 12,
          flexShrink: 0,
        },
        text(value)
      );
    }
    if (tag === "blockquote")
      return element("div", { display: "flex", flexDirection: "column", borderLeft: "4px solid #1d70e8", paddingLeft: 18, color: "#595959", marginBottom: 12 }, children(false));
    if (["ul", "ol"].includes(tag)) return element("div", { display: "flex", flexDirection: "column", marginBottom: 12 }, children(false));
    if (tag === "li")
      return element("div", { display: "flex", marginBottom: 4 }, [
        element("div", { display: "flex", width: fontSize * 1.25, flexShrink: 0 }, ordered ? `${start + index}.` : "•"),
        element("div", { display: "block", flexGrow: 1, flexBasis: 0, paddingLeft: 4 }, children(true)),
      ]);
    if (tag === "hr") return element("div", { display: "flex", borderTop: "1px solid #e5e5e5", marginBottom: 12 }, []);
    if (["table", "thead", "tbody"].includes(tag)) return element("div", { display: "flex", flexDirection: "column", width: "100%", fontSize: fontSize * 0.8 }, children(false));
    if (tag === "tr") return element("div", { display: "flex", borderBottom: "1px solid #e5e5e5" }, children(false));
    if (["td", "th"].includes(tag)) return element("div", { display: "block", flexBasis: 0, flexGrow: 1, padding: 8, fontWeight: tag === "th" ? 700 : 400 }, children(true));
    const heading = /^h[1-6]$/.test(tag);
    return element(
      "div",
      {
        display: "block",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        flexShrink: 0,
        marginBottom: 12,
        ...(heading ? { fontWeight: 700, fontSize: fontSize * (tag === "h1" ? 1.4 : tag === "h2" ? 1.2 : 1.05), lineHeight: 1.2 } : {}),
      },
      children(true)
    );
  }
  const content = render(tree);
  return { content, truncated, hasContent: remaining < limit };
}
