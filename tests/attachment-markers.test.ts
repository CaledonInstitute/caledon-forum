import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { attachmentMarker, removeAttachmentMarkers, splitAttachments } from "../src/lib/attachment-markers";
import { markdown } from "../src/lib/markdown";
import { MessageContent } from "../src/components/DirectMessages";
import { createIdentity, encryptMessage, decryptMessage } from "../src/lib/dm-crypto";
import { dayKey, dayLabel, clockTime, postTime } from "../src/lib/post-time";

const file = { id: "11111111-1111-4111-8111-111111111111", name: "notes.txt", mime: "text/plain", size: 123 };
const marker = attachmentMarker(file);
it("splits blocks at the beginning, middle and end, preserves order, and removes all references", () => {
  for (const body of [marker + "\nafter", "before\n" + marker, "before\n" + marker + "\nafter"]) {
    expect(splitAttachments(body).filter((p) => p.type === "attachment")).toHaveLength(1);
    expect(removeAttachmentMarkers(body, file.id)).not.toContain("attachment:");
  }
  expect(splitAttachments(`before\n${marker}\nafter`).map((p) => p.type)).toEqual(["text", "attachment", "text"]);
  expect(removeAttachmentMarkers(`${marker}\ntext\n${marker}\n`, file.id)).toBe("text\n");
});
it("leaves escaped markers and fenced, indented and multiline inline code untouched", () => {
  for (const body of [`\\${marker}`, `\`\`\`md\n${marker}\n\`\`\``, `~~~\n${marker}\n~~~`, `    ${marker}`, `\`\n${marker}\n\``, `<pre>\n${marker}\n</pre>`]) {
    expect(splitAttachments(body)).toEqual([{ type: "text", text: body }]);
  }
});
it("renders allowed media in order, escapes filenames, appends legacy files and deduplicates references", async () => {
  const image = { ...file, name: 'photo ["<img>].png', mime: "image/png" };
  const legacy = { ...file, id: "22222222-2222-4222-8222-222222222222" };
  const html = await markdown(`Before\n${attachmentMarker(image)}\nAfter\n${attachmentMarker(image)}`, [], undefined, undefined, [image, legacy]);
  expect(html.indexOf("Before")).toBeLessThan(html.indexOf("<figure"));
  expect(html.indexOf("<figure")).toBeLessThan(html.indexOf("After"));
  expect(html.lastIndexOf("<figure")).toBeGreaterThan(html.indexOf("After"));
  expect(html.match(/class="attachment-view"/g)).toHaveLength(2);
  expect(html).toContain("&lt;img&gt;");
  expect(html).not.toContain('"<img>');
  for (const mime of ["video/mp4", "audio/mpeg"]) {
    expect(await markdown(marker, [], undefined, undefined, [{ ...file, mime }])).toContain(mime.startsWith("video") ? "<video" : "<audio");
  }
});
it("does not fetch or expose files outside the associated attachment list", async () => {
  const html = await markdown(marker);
  expect(html).toContain("File unavailable.");
  expect(html).not.toContain("/api/files/");
  const dm = renderToStaticMarkup(createElement(MessageContent, { text: `before\n${marker}\nafter` }));
  expect(dm).toContain("File unavailable.");
  expect(dm).not.toContain("/api/files/");
});
it("keeps DM text plain and attachment keys inside the encrypted payload during round trip", async () => {
  const sender = (await createIdentity("alice", 1, "test-password")).identity;
  const recipient = (await createIdentity("bob", 1, "test-password")).identity;
  const attachment = { ...file, key: btoa("a".repeat(32)), iv: btoa("b".repeat(12)) };
  const payload = { text: `**before** <img src=x>\n${marker}\nhttps://example.com after`, attachments: [attachment] };
  const context = { id: crypto.randomUUID(), conversationId: crypto.randomUUID(), senderId: "alice", recipientId: "bob", senderVersion: 1, recipientVersion: 1 };
  const envelopes = await encryptMessage(sender, recipient.publicKey, context, payload);
  expect(JSON.stringify(envelopes)).not.toContain(attachment.key);
  const decoded = await decryptMessage(
    recipient,
    {
      id: context.id,
      conversation_id: context.conversationId,
      sender_id: "alice",
      sender_version: 1,
      recipient_version: 1,
      sender_public_key: JSON.stringify(sender.publicKey),
      envelopes: JSON.stringify(envelopes),
    },
    "alice"
  );
  expect(decoded).toEqual(payload);
  const html = renderToStaticMarkup(createElement(MessageContent, { text: decoded.text, files: decoded.attachments }));
  expect(html).toContain("**before** &lt;img src=x&gt;");
  expect(html.indexOf("before")).toBeLessThan(html.indexOf("Open notes.txt"));
  expect(html.indexOf("Open notes.txt")).toBeLessThan(html.indexOf("after"));
  expect(html).not.toContain(attachment.key);
});
it("uses WIB for display and complete day keys across midnight and years", () => {
  const before = Date.parse("2026-12-31T16:59:00Z"),
    after = before + 60000;
  expect(postTime(before)).toBe("Dec 31 23:59");
  expect(postTime(after)).toBe("Jan 1 00:00");
  expect(dayLabel(after)).toBe("Jan 1");
  expect(clockTime(after)).toBe("00:00");
  expect(dayKey(before)).toBe("2026-12-31");
  expect(dayKey(after)).toBe("2027-01-01");
  expect(dayKey(after)).not.toBe(dayKey(Date.parse("2026-01-01T00:00:00Z")));
});

it("keeps Markdown reference definitions working across an attachment block", async () => {
  const html = await markdown(`[Research][source]\n${marker}\nAfter\n\n[source]: https://example.com`, [], undefined, undefined, [file]);
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain("<figure");
  expect(html).not.toContain("caledonattachment");
});

it("does not let an unmatched backtick turn subsequent file blocks into code", () => {
  expect(splitAttachments(`An unmatched \`\n${marker}`).at(-1)?.type).toBe("attachment");
});
it("renders file blocks inside supported HTML containers without exposing internal slots", async () => {
  const html = await markdown(`<div>\n${marker}\n</div>`, [], undefined, undefined, [file]);
  expect(html).toContain("<figure");
  expect(html).not.toContain("caledonattachment");
  expect(html.match(/class="attachment-view"/g)).toHaveLength(1);
});
