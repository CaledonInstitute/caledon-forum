import { useEditor, EditorContent } from "@tiptap/react";
import { Node, mergeAttributes, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { useEffect, useRef, useState, useId, type RefObject } from "react";
import katex from "katex";
import { importMarkdown, documentBody, type EditorDocument } from "../lib/editor-document";
import type { Attachment } from "../lib/upload-policy";

const AttachmentNode = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  addAttributes() {
    return { id: { default: "" }, name: { default: "File" } };
  },
  parseHTML() {
    return [{ tag: "div[data-attachment]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-attachment": node.attrs.id, class: "editor-attachment", contenteditable: "false" }), node.attrs.name];
  },
});
const ImportedContent = Node.create({
  name: "importedContent",
  group: "block",
  atom: true,
  addAttributes() {
    return { source: { default: "" } };
  },
  parseHTML() {
    return [];
  },
  renderHTML() {
    return ["div", { "data-imported-content": "" }, "Imported content"];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "post-content editor-imported";
      dom.contentEditable = "false";
      dom.textContent = "Loading imported content…";
      let alive = true;
      void import("../lib/markdown").then(async ({ markdown }) => {
        const html = await markdown(node.attrs.source);
        if (alive) dom.innerHTML = html;
      });
      return {
        dom,
        destroy: () => {
          alive = false;
        },
      };
    };
  },
});
const ProxiedImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "editor-image";
      dom.contentEditable = "false";
      const image = document.createElement("img");
      image.alt = node.attrs.alt || "External image";
      const status = document.createElement("span");
      status.textContent = "Loading image preview…";
      dom.appendChild(status);
      let alive = true;
      void fetch("/api/forum/preview-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: `![](${String(node.attrs.src).replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29"))})` }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error();
          const data = (await response.json()) as any;
          const preview = data.links?.find((link: any) => link.kind === "image");
          if (!preview) throw new Error();
          if (alive) {
            image.src = `/api/media/${preview.id}`;
            dom.replaceChildren(image);
          }
        })
        .catch(() => {
          if (alive) status.textContent = "Image preview unavailable. Check the URL or use Preview to retry.";
        });
      return {
        dom,
        destroy: () => {
          alive = false;
        },
      };
    };
  },
});
const MentionNode = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { id: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-mention]" }];
  },
  renderHTML({ node }) {
    return ["span", { "data-mention": node.attrs.id, class: "mention" }, "@" + node.attrs.id];
  },
});
function mathNode(name: string, inline: boolean) {
  return Node.create({
    name,
    group: inline ? "inline" : "block",
    inline,
    atom: true,
    addAttributes() {
      return { latex: { default: "" } };
    },
    parseHTML() {
      return [{ tag: `${inline ? "span" : "div"}[data-math="${name}"]` }];
    },
    renderHTML({ node }) {
      return [inline ? "span" : "div", { "data-math": name, "data-latex": node.attrs.latex }, node.attrs.latex];
    },
    addNodeView() {
      return ({ node, editor, getPos }) => {
        const dom = document.createElement(inline ? "span" : "div");
        dom.className = "editor-math";
        dom.contentEditable = "false";
        dom.tabIndex = 0;
        dom.setAttribute("role", "button");
        dom.setAttribute("aria-label", "Edit formula");
        katex.render(node.attrs.latex, dom, { displayMode: !inline, throwOnError: false, trust: false, maxExpand: 1000, maxSize: 20 });
        const edit = () => {
          const latex = prompt("LaTeX formula", node.attrs.latex);
          const pos = getPos();
          if (latex !== null && typeof pos === "number")
            editor
              .chain()
              .focus()
              .command(({ tr }) => {
                tr.setNodeMarkup(pos, undefined, { latex });
                return true;
              })
              .run();
        };
        dom.ondblclick = edit;
        dom.onkeydown = (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            edit();
          }
        };
        return { dom };
      };
    },
  });
}
export interface VisualEditorHandle {
  clear: () => void;
  insertAttachment: (file: { id: string; name: string }) => void;
  replaceAttachment: (key: string, file: Attachment) => void;
  removeAttachment: (id: string) => void;
}
export default function VisualEditor({
  initial = "",
  initialDocument,
  disabled,
  reply,
  onChange,
  editorRef,
}: {
  initial?: string;
  initialDocument?: EditorDocument;
  disabled: boolean;
  reply: boolean;
  onChange: (body: string, doc: EditorDocument) => void;
  editorRef: RefObject<VisualEditorHandle | null>;
}) {
  const change = useRef(onChange);
  const mentionListId = useId();
  change.current = onChange;
  const [query, setQuery] = useState<{ text: string; from: number; to: number } | null>(null);
  const [users, setUsers] = useState<{ username: string; name: string }[]>([]);
  const [selected, setSelected] = useState(0);
  const [panel, setPanel] = useState<"link" | "code" | "math" | "image" | null>(null);
  const [input, setInput] = useState("");
  const [blockMath, setBlockMath] = useState(false);
  const [message, setMessage] = useState("");
  const state = useRef({ query, users, selected });
  state.current = { query, users, selected };
  const chooseRef = useRef<(username: string) => void>(() => {});
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, underline: false, link: { openOnClick: false } }),
      TableKit.configure({ table: { resizable: false } }),
      ProxiedImage.configure({ inline: true }),
      AttachmentNode,
      ImportedContent,
      MentionNode,
      mathNode("inlineMath", true),
      mathNode("blockMath", false),
    ],
    content: (initialDocument?.doc ||
      importMarkdown(initial)?.doc || { type: "doc", content: [{ type: "paragraph", content: initial ? [{ type: "text", text: initial }] : [] }] }) as JSONContent,
    editorProps: {
      attributes: { role: "textbox", "aria-multiline": "true", "aria-label": reply ? "Your reply" : "Your post", class: "post-content visual-editor" },
      handleKeyDown: (_view, event) => {
        const current = state.current;
        if (!current.query) return false;
        if (event.key === "Escape") {
          setQuery(null);
          return true;
        }
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && current.users.length) {
          event.preventDefault();
          setSelected((n) => (n + (event.key === "ArrowDown" ? 1 : -1) + current.users.length) % current.users.length);
          return true;
        }
        if (event.key === "Enter" && current.users[current.selected]) {
          event.preventDefault();
          chooseRef.current(current.users[current.selected].username);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const doc: EditorDocument = { version: 1, doc: editor.getJSON() as any };
      change.current(documentBody(doc), doc);
    },
    onTransaction: ({ editor }) => {
      const { $from, empty, from } = editor.state.selection;
      if (!empty || $from.parent.type.name === "codeBlock") {
        setQuery(null);
        return;
      }
      const before = $from.parent.textBetween(0, $from.parentOffset, "\n", "\uFFFC");
      const match = /(?:^|\s)@([A-Za-z0-9_]{0,30})$/.exec(before);
      const next = match ? { text: match[1], from: from - match[1].length - 1, to: from } : null;
      setQuery((previous) => (previous?.text === next?.text && previous?.from === next?.from && previous?.to === next?.to ? previous : next));
    },
  });
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);
  // Tiptap owns the live draft. Feeding parent snapshots back into setContent
  // can reset the selection during a toolbar action or a rapid upload update.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    dom.setAttribute("aria-autocomplete", "list");
    dom.setAttribute("aria-expanded", String(!!query && users.length > 0));
    if (query && users.length) {
      dom.setAttribute("aria-controls", mentionListId);
      dom.setAttribute("aria-activedescendant", `${mentionListId}-${selected}`);
    } else {
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-activedescendant");
    }
  }, [editor, query, users, selected, mentionListId]);
  useEffect(() => {
    if (!editor) return;
    const doc: EditorDocument = { version: 1, doc: editor.getJSON() as any };
    change.current(documentBody(doc), doc);
    function updateFile(id: string, replacement?: Attachment) {
      const transaction = editor!.state.tr;
      const nodes: { pos: number; size: number }[] = [];
      editor!.state.doc.descendants((node, pos) => {
        if (node.type.name === "attachment" && node.attrs.id === id) nodes.push({ pos, size: node.nodeSize });
      });
      for (const n of nodes.reverse())
        replacement ? transaction.setNodeMarkup(n.pos, undefined, { id: replacement.id, name: replacement.name }) : transaction.delete(n.pos, n.pos + n.size);
      editor!.view.dispatch(transaction);
    }
    editorRef.current = {
      clear: () => editor.commands.clearContent(),
      insertAttachment: (file) => {
        editor
          .chain()
          .focus()
          .insertContent([{ type: "attachment", attrs: file }, { type: "paragraph" }])
          .run();
      },
      replaceAttachment: (key, file) => updateFile(key, file),
      removeAttachment: (id) => updateFile(id),
    };
    return () => {
      editorRef.current = null;
    };
  }, [editor]);
  useEffect(() => {
    setUsers([]);
    setSelected(0);
    if (!query) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetch("/api/forum/mentions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: query.text }),
          signal: abort.signal,
        });
        if (r.ok) {
          const result = (await r.json()) as any;
          setUsers(result.users);
        }
      } catch {}
    }, 180);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query?.text]);
  chooseRef.current = (username) => {
    if (!editor || !query) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: query.from, to: query.to })
      .insertContent([
        { type: "mention", attrs: { id: username } },
        { type: "text", text: " " },
      ])
      .run();
    setQuery(null);
  };
  function open(next: typeof panel) {
    setPanel(next);
    setInput(next === "code" ? editor?.getAttributes("codeBlock").language || "" : next === "link" ? editor?.getAttributes("link").href || "" : "");
    setMessage("");
  }
  function apply() {
    if (!editor) return;
    if (panel === "link" || panel === "image") {
      try {
        const url = new URL(input);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
        panel === "link" ? editor.chain().focus().extendMarkRange("link").setLink({ href: url.href }).run() : editor.chain().focus().setImage({ src: url.href }).run();
      } catch {
        setMessage("Enter a valid HTTP or HTTPS URL.");
        return;
      }
    }
    if (panel === "code") {
      if (input && !/^[\w+-]{1,30}$/.test(input)) {
        setMessage("Enter a language such as python or javascript.");
        return;
      }
      editor.isActive("codeBlock")
        ? editor.chain().focus().updateAttributes("codeBlock", { language: input }).run()
        : editor.chain().focus().toggleCodeBlock({ language: input }).run();
    }
    if (panel === "math") {
      if (!input.trim()) return;
      editor
        .chain()
        .focus()
        .insertContent({ type: blockMath ? "blockMath" : "inlineMath", attrs: { latex: input } })
        .run();
    }
    setPanel(null);
    editor.view.focus();
  }
  const button = (label: string, active: boolean, fn: () => void) => (
    <button
      type="button"
      disabled={!editor || disabled}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        fn();
        editor?.view.focus();
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="editor-shell">
      <div className="editor-toolbar" role="toolbar" aria-label="Text formatting">
        {button("Bold", !!editor?.isActive("bold"), () => editor?.chain().focus().toggleBold().run())}
        {button("Italic", !!editor?.isActive("italic"), () => editor?.chain().focus().toggleItalic().run())}
        {button("Strike", !!editor?.isActive("strike"), () => editor?.chain().focus().toggleStrike().run())}
        <select
          aria-label="Paragraph style"
          disabled={!editor || disabled}
          value={editor?.isActive("heading") ? editor.getAttributes("heading").level : 0}
          onChange={(e) =>
            Number(e.target.value)
              ? editor
                  ?.chain()
                  .focus()
                  .toggleHeading({ level: Number(e.target.value) as 1 | 2 | 3 })
                  .run()
              : editor?.chain().focus().setParagraph().run()
          }
        >
          <option value="0">Paragraph</option>
          <option value="1">Heading 1</option>
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
        </select>
        {button("List", !!editor?.isActive("bulletList"), () => editor?.chain().focus().toggleBulletList().run())}
        {button("Numbered", !!editor?.isActive("orderedList"), () => editor?.chain().focus().toggleOrderedList().run())}
        {button("Quote", !!editor?.isActive("blockquote"), () => editor?.chain().focus().toggleBlockquote().run())}
        {button("Link", !!editor?.isActive("link"), () => open("link"))}
        <details>
          <summary>Insert</summary>
          <div className="editor-insert">
            {button("Table", false, () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
            {button("Code block", false, () => open("code"))}
            {button("Inline code", !!editor?.isActive("code"), () => editor?.chain().focus().toggleCode().run())}
            {button("Formula", false, () => open("math"))}
            {button("Image URL", false, () => open("image"))}
            {button("Attachment", false, () =>
              document
                .getElementById(reply ? "reply" : "compose")
                ?.querySelector<HTMLInputElement>('input[type="file"]')
                ?.click()
            )}
          </div>
        </details>
        {button("Undo", false, () => editor?.chain().focus().undo().run())}
        {button("Redo", false, () => editor?.chain().focus().redo().run())}
      </div>
      {editor?.isActive("table") && (
        <div className="editor-toolbar" aria-label="Table actions">
          {button("Add row", false, () => editor.chain().focus().addRowAfter().run())}
          {button("Add column", false, () => editor.chain().focus().addColumnAfter().run())}
          {button("Delete row", false, () => editor.chain().focus().deleteRow().run())}
          {button("Delete column", false, () => editor.chain().focus().deleteColumn().run())}
          {button("Delete table", false, () => editor.chain().focus().deleteTable().run())}
        </div>
      )}
      {panel && (
        <div className="editor-panel">
          <label>
            {panel === "math" ? "LaTeX formula" : panel === "code" ? "Code language" : "URL"}
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  apply();
                }
                if (e.key === "Escape") setPanel(null);
              }}
            />
          </label>
          {panel === "math" && (
            <label>
              <input type="checkbox" checked={blockMath} onChange={(e) => setBlockMath(e.target.checked)} />
              Display on its own line
            </label>
          )}
          <button type="button" className="button secondary" onClick={apply}>
            Insert
          </button>
          {panel === "link" && editor?.isActive("link") && (
            <button
              type="button"
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                setPanel(null);
                editor.view.focus();
              }}
            >
              Remove link
            </button>
          )}
          <button type="button" onClick={() => setPanel(null)}>
            Cancel
          </button>
          <p role="status">{message}</p>
        </div>
      )}
      <EditorContent editor={editor} />
      {query && users.length > 0 && (
        <div className="editor-mentions" id={mentionListId} role="listbox" aria-label="People">
          {users.map((user, i) => (
            <button
              key={user.username}
              type="button"
              role="option"
              id={`${mentionListId}-${i}`}
              aria-selected={i === selected}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => chooseRef.current(user.username)}
            >
              {user.name} <span>@{user.username}</span>
            </button>
          ))}
        </div>
      )}
      {!editor && <p className="muted small">Loading editor…</p>}
    </div>
  );
}
