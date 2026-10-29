import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { isValidUsername } from "./usernames";

const pattern = () => /(?<![\p{L}\p{N}_@/\\.\-])@([a-zA-Z_][a-zA-Z0-9_]{0,29})(?![\p{L}\p{N}_@\-])/gu;

// Traverse prose only: links, code, and math keep their literal contents.
export function transformMentions(tree: any, found: (username: string) => void = () => {}) {
  function walk(node: any) {
    if (node.type === "element" && (["a", "code", "pre", "script", "style"].includes(node.tagName) || node.properties?.className?.some((c: string) => c.startsWith("math-"))))
      return;
    if (!node.children) return;
    node.children = node.children.flatMap((child: any) => {
      if (child.type !== "text") {
        walk(child);
        return [child];
      }
      const nodes: any[] = [];
      let end = 0;
      for (const match of child.value.matchAll(pattern())) {
        const username = match[1].toLowerCase();
        if (!isValidUsername(username)) continue;
        nodes.push({ type: "text", value: child.value.slice(end, match.index) });
        nodes.push({ type: "element", tagName: "a", properties: { href: `/${username}`, className: ["mention"] }, children: [{ type: "text", value: match[0] }] });
        found(username);
        end = match.index + match[0].length;
      }
      nodes.push({ type: "text", value: child.value.slice(end) });
      return nodes;
    });
  }
  walk(tree);
}

export function extractMentions(body: string) {
  const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize);
  const names = new Set<string>();
  transformMentions(parser.runSync(parser.parse(body)), (name) => names.add(name));
  return [...names];
}
