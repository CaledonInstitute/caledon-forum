import { all } from "./db";
import { exceedsCharacters, excerpt } from "./content";
import { normalizePreviews } from "./previews";
import type { ForumPost, LinkPreview } from "./types";
export interface PostContent {
  links: LinkPreview[];
  body: string;
  long: boolean;
}
/** Read path deliberately never imports a Markdown/HTML parser or renderer. */
export async function preparePostContent(items: ForumPost[], fullIds: Set<string> = new Set()) {
  const active = items.filter((p) => !p.deleted);
  const metadata = active.length
    ? await all<LinkPreview & { postId: string }>(
        `SELECT pl.post_id AS postId,lp.id,lp.url,lp.kind,lp.title,lp.description,lp.site,lp.image,lp.video_id AS videoId,lp.checked_at AS checkedAt FROM post_links pl JOIN link_previews lp ON lp.id=pl.preview_id WHERE pl.post_id IN (SELECT value FROM json_each(?)) ORDER BY pl.position`,
        JSON.stringify(active.map((p) => p.id))
      )
    : [];
  return new Map(
    items.map((p) => {
      const long = !fullIds.has(p.id) && exceedsCharacters(p.body, 600);
      return [
        p.id,
        {
          links: normalizePreviews(metadata.filter((l) => l.postId === p.id)),
          body: p.deleted ? "" : long ? excerpt(p.body, 600) : p.body,
          long,
        },
      ];
    })
  );
}
