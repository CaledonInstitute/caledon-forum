import { all, db } from "./db";
import { importMarkdown } from "./editor-document";
/** Small, resumable batches. A legacy marker records unsupported source content. */
export async function migrateEditorBatch(limit = 20) {
  const rows = await all<{ id: string; original_body: string }>("SELECT id,original_body FROM posts WHERE legacy_readonly=1 AND editor_doc IS NULL AND deleted=0 LIMIT ?", limit);
  if (rows.length)
    await db().batch(
      rows.map((row) =>
        db()
          .prepare("UPDATE posts SET editor_doc=? WHERE id=? AND editor_doc IS NULL")
          .bind(JSON.stringify(importMarkdown(row.original_body) || { version: 1, legacy: true }), row.id)
      )
    );
  return rows.length;
}
