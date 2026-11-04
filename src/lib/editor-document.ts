import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { MAX_CHARACTERS, countCharacters } from "./content";
import { attachmentMarker } from "./attachment-markers";

export type DocNode = { type: string; text?: string; attrs?: Record<string, any>; marks?: { type: string; attrs?: Record<string, any> }[]; content?: DocNode[] };
export type EditorDocument = { version: 1; doc: DocNode };
const allowed = new Set([
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "hardBreak",
  "horizontalRule",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "inlineMath",
  "blockMath",
  "mention",
  "attachment",
  "image",
  "importedContent",
]);
const marks = new Set(["bold", "italic", "strike", "code", "link"]);
const escape = (s: string) => s.replace(/[\\`*_{}\[\]<>~$|]/g, "\\$&");
const safeUrl = (value: unknown) => {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value) || /[\s<>"\\]/.test(value)) throw new Error("Use a valid HTTP or HTTPS link.");
  const url = new URL(value);
  if (url.username || url.password) throw new Error("Links cannot contain credentials.");
  return url.href;
};
export function validateDocument(value: unknown): EditorDocument {
  if (!value || (value as any).version !== 1) throw new Error("Unsupported document version.");
  let nodes = 0;
  function check(n: any, depth = 0): DocNode {
    if (!n || !allowed.has(n.type) || ++nodes > 10000 || depth > 32) throw new Error("This document is invalid or too complex.");
    const result: DocNode = { type: n.type };
    if (n.type === "text") {
      if (typeof n.text !== "string" || !n.text) throw new Error("Invalid text.");
      result.text = n.text;
    }
    if (n.content !== undefined) {
      if (!Array.isArray(n.content)) throw new Error("Invalid document content.");
      result.content = n.content.map((c: any) => check(c, depth + 1));
    }
    if (n.marks) {
      if (!Array.isArray(n.marks) || n.marks.length > 5) throw new Error("Invalid text format.");
      result.marks = n.marks.map((m: any) => {
        if (!marks.has(m.type)) throw new Error("Unsupported text format.");
        return { type: m.type, ...(m.type === "link" ? { attrs: { href: safeUrl(m.attrs?.href) } } : {}) };
      });
    }
    const a = n.attrs || {};
    if (n.type === "heading") result.attrs = { level: Math.min(3, Math.max(1, Number(a.level) || 1)) };
    if (n.type === "orderedList") result.attrs = { start: Math.max(1, Math.min(100000, Number(a.start) || 1)) };
    if (n.type === "codeBlock") result.attrs = { language: typeof a.language === "string" && /^[\w+-]{1,30}$/.test(a.language) ? a.language : null };
    if (n.type === "inlineMath" || n.type === "blockMath") {
      if (typeof a.latex !== "string" || a.latex.length > 5000) throw new Error("Invalid formula.");
      result.attrs = { latex: a.latex };
    }
    if (n.type === "mention") {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,29}$/.test(a.id)) throw new Error("Invalid mention.");
      result.attrs = { id: a.id };
    }
    if (n.type === "attachment") {
      if (!/^[0-9a-f-]{36}$/.test(a.id) || typeof a.name !== "string" || a.name.length > 255) throw new Error("Invalid attachment.");
      result.attrs = { id: a.id, name: a.name };
    }
    if (n.type === "image") result.attrs = { src: safeUrl(a.src), alt: typeof a.alt === "string" ? a.alt.slice(0, 300) : "" };
    if (n.type === "tableCell" || n.type === "tableHeader") result.attrs = { colspan: 1, rowspan: 1, colwidth: null };
    if (n.type === "importedContent") {
      if (typeof a.source !== "string" || countCharacters(a.source) > MAX_CHARACTERS) throw new Error("Invalid imported content.");
      result.attrs = { source: a.source };
    }
    const blocks = ["paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock", "horizontalRule", "table", "blockMath", "attachment", "importedContent"];
    const inline = ["text", "hardBreak", "mention", "inlineMath", "image"];
    const children: Record<string, string[]> = {
      doc: blocks,
      blockquote: blocks,
      paragraph: inline,
      heading: inline,
      bulletList: ["listItem"],
      orderedList: ["listItem"],
      listItem: blocks,
      codeBlock: ["text"],
      table: ["tableRow"],
      tableRow: ["tableCell", "tableHeader"],
      tableCell: blocks,
      tableHeader: blocks,
    };
    if (result.content?.some((c) => !children[n.type]?.includes(c.type))) throw new Error("Invalid document structure.");
    if (["table", "tableRow", "tableCell", "tableHeader", "listItem"].includes(n.type) && !result.content?.length) throw new Error("Empty table or list structure.");
    return result;
  }
  const doc = check((value as any).doc);
  if (doc.type !== "doc") throw new Error("Invalid document root.");
  if (countCharacters(documentBody({ version: 1, doc })) > MAX_CHARACTERS) throw new Error("Keep your post within 25,000 characters.");
  return { version: 1, doc };
}
export function documentBody(value: EditorDocument): string {
  function render(n: DocNode): string {
    const a = n.attrs || {},
      children = (n.content || []).map(render);
    if (n.type === "text") {
      let t = escape(n.text || "");
      const wrap = (value: string, delimiter: string) => {
        const leading = /^\s*/.exec(value)![0],
          trailing = /\s*$/.exec(value)![0];
        const core = value.slice(leading.length, value.length - trailing.length);
        return core ? leading + delimiter + core + delimiter + trailing : value;
      };
      for (const m of n.marks || []) {
        if (m.type === "code") {
          const fence = "`".repeat(Math.max(1, ...((n.text || "").match(/`+/g) || []).map((x) => x.length + 1)));
          t = fence + " " + (n.text || "") + " " + fence;
        }
        if (m.type === "bold") t = wrap(t, "**");
        if (m.type === "italic") t = wrap(t, "*");
        if (m.type === "strike") t = wrap(t, "~~");
        if (m.type === "link") t = "[" + t + "](" + encodeURI(m.attrs?.href || "").replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29")) + ")";
      }
      return t;
    }
    const inline = children.join("");
    if (n.type === "doc" || n.type === "blockquote") {
      const text = children.join("\n\n");
      return n.type === "blockquote"
        ? text
            .split("\n")
            .map((l) => "> " + l)
            .join("\n")
        : text;
    }
    if (n.type === "heading") return "#".repeat(a.level || 1) + " " + inline;
    if (n.type === "codeBlock") {
      const t = (n.content || []).map((c) => c.text || "").join("");
      const fence = "`".repeat(Math.max(3, ...(t.match(/`+/g) || []).map((x) => x.length + 1)));
      return fence + (a.language || "") + "\n" + t + "\n" + fence;
    }
    if (n.type === "bulletList" || n.type === "orderedList")
      return children
        .map((c, i) => {
          const prefix = n.type === "bulletList" ? "- " : `${(a.start || 1) + i}. `;
          return prefix + c.replace(/\n/g, "\n" + " ".repeat(prefix.length));
        })
        .join("\n");
    if (n.type === "listItem") return children.join("\n\n");
    if (n.type === "hardBreak") return "  \n";
    if (n.type === "horizontalRule") return "---";
    if (n.type === "inlineMath") return "$" + a.latex + "$";
    if (n.type === "blockMath") return "$$\n" + a.latex + "\n$$";
    if (n.type === "mention") return "@" + a.id;
    if (n.type === "attachment") return attachmentMarker({ id: a.id, name: a.name });
    if (n.type === "image") return "![" + escape(a.alt || "") + "](" + String(a.src).replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29")) + ")";
    if (n.type === "importedContent") return a.source;
    if (n.type === "table") {
      const rows = (n.content || []).map(
        (row) => "| " + (row.content || []).map((cell) => (cell.content || []).map(render).join("<br>").replace(/\n/g, "<br>")).join(" | ") + " |"
      );
      if (rows.length) rows.splice(1, 0, "| " + (n.content?.[0]?.content || []).map(() => "---").join(" | ") + " |");
      return rows.join("\n");
    }
    return inline;
  }
  return render(value.doc).trim();
}

/** API imports retain unsupported HTML as an atomic visual block, never a source editor. */
export function importApiDocument(source: string): EditorDocument {
  return importMarkdown(source) || validateDocument({ version: 1, doc: { type: "doc", content: [{ type: "importedContent", attrs: { source } }] } });
}

/** Unsupported raw HTML stays on the lossless legacy rendering path. */
export function importMarkdown(source: string): EditorDocument | null {
  const ast = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(source) as any;
  let unsupported = false;
  function convert(n: any, inherited: DocNode["marks"] = []): DocNode[] {
    const children = () => (n.children || []).flatMap((c: any) => convert(c, inherited));
    const type: Record<string, string> = {
      root: "doc",
      paragraph: "paragraph",
      heading: "heading",
      blockquote: "blockquote",
      listItem: "listItem",
      break: "hardBreak",
      thematicBreak: "horizontalRule",
      table: "table",
      tableRow: "tableRow",
      tableCell: "tableCell",
    };
    if (n.type === "text") return n.value ? [{ type: "text", text: n.value, ...(inherited?.length ? { marks: inherited } : {}) }] : [];
    if (["strong", "emphasis", "delete", "link"].includes(n.type)) {
      const mark = { type: ({ strong: "bold", emphasis: "italic", delete: "strike", link: "link" } as any)[n.type], ...(n.type === "link" ? { attrs: { href: n.url } } : {}) };
      if (n.type === "link" && n.url.startsWith("attachment:"))
        return [{ type: "attachment", attrs: { id: n.url.slice(11), name: n.children.map((c: any) => c.value || "").join("") } }];
      return (n.children || []).flatMap((c: any) => convert(c, [...(inherited || []), mark]));
    }
    if (n.type === "inlineCode") return [{ type: "text", text: n.value || " ", marks: [{ type: "code" }] }];
    if (n.type === "code") return [{ type: "codeBlock", attrs: { language: n.lang }, content: n.value ? [{ type: "text", text: n.value }] : [] }];
    if (n.type === "math" || n.type === "inlineMath") return [{ type: n.type === "math" ? "blockMath" : "inlineMath", attrs: { latex: n.value } }];
    if (n.type === "image") return [{ type: "image", attrs: { src: n.url, alt: n.alt || "" } }];
    if (n.type === "list") return [{ type: n.ordered ? "orderedList" : "bulletList", attrs: { start: n.start || 1 }, content: children() }];
    if (type[n.type]) {
      const result: DocNode = { type: type[n.type], content: children() };
      if (n.type === "heading") {
        if (n.depth > 3) unsupported = true;
        result.attrs = { level: n.depth };
      }
      if (n.type === "tableCell") result.content = [{ type: "paragraph", content: result.content }];
      if (n.type === "paragraph" && result.content?.some((c) => c.type === "attachment")) {
        const out: DocNode[] = [];
        let inline: DocNode[] = [];
        for (const c of result.content) {
          if (c.type === "attachment") {
            if (inline.length) out.push({ type: "paragraph", content: inline });
            inline = [];
            out.push(c);
          } else inline.push(c);
        }
        if (inline.length) out.push({ type: "paragraph", content: inline });
        return out;
      }
      return [result];
    }
    unsupported = true;
    return [];
  }
  const doc = convert(ast)[0];
  if (unsupported) return null;
  try {
    return validateDocument({ version: 1, doc });
  } catch {
    return null;
  }
}
