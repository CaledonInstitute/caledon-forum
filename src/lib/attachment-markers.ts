import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Attachment } from "./upload-policy";

export type ContentPart = { type: "text"; text: string } | { type: "attachment"; id: string; source: string };
const marker = /^\[((?:\\.|[^\]\\])*)\]\(attachment:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)[ \t]*$/i;
export function attachmentMarker(file: Pick<Attachment, "id" | "name">) {
  return `[${file.name.replace(/[\r\n]/g, " ").replace(/[\\\[\]()`*_<>]/g, "\\$&")}](attachment:${file.id})`;
}
const parser = unified().use(remarkParse).freeze();
/** Only standalone, unescaped blocks outside code. Parsing here identifies code
 * boundaries; DM text is still rendered as plain React text, never Markdown. */
export function splitAttachments(body: string): ContentPart[] {
  if (!/\]\(attachment:/i.test(body)) return body ? [{ type: "text", text: body }] : [];
  const blocked: { start: number; end: number }[] = [];
  function walk(node: any) {
    if ((node.type === "code" || node.type === "inlineCode" || (node.type === "html" && /<\/?(?:pre|code)(?:\s|>)/i.test(node.value))) && node.position) {
      blocked.push({ start: node.position.start.offset, end: node.position.end.offset });
      return;
    }
    node.children?.forEach(walk);
  }
  walk(parser.parse(body));
  const parts: ContentPart[] = [];
  let text = "",
    offset = 0;
  for (const line of body.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const raw = line.replace(/\r?\n$/, "");
    const match = !blocked.some((range) => offset >= range.start && offset < range.end) ? marker.exec(raw) : null;
    if (match) {
      if (text) parts.push({ type: "text", text });
      parts.push({ type: "attachment", id: match[2], source: line });
      text = "";
    } else text += line;
    offset += line.length;
  }
  if (text) parts.push({ type: "text", text });
  return parts;
}
export function removeAttachmentMarkers(body: string, id: string) {
  return splitAttachments(body)
    .map((part) => (part.type === "text" ? part.text : part.id === id ? "" : part.source))
    .join("");
}
