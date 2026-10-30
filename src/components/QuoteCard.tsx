import { BadgeCheck } from "lucide-react";
import type { QuotedPost } from "../lib/types";
import { postTime } from "../lib/post-time";
import UserAvatar from "./UserAvatar";

export default function QuoteCard({ quote: q }: { quote: QuotedPost }) {
  if (q.unavailable)
    return (
      <aside className="quote-card quote-unavailable" aria-label="Unavailable quoted post">
        <p>This quoted post is no longer available.</p>
      </aside>
    );
  const created = new Date(q.createdAt);
  const time = postTime(q.createdAt);
  return (
    <aside className="quote-card" aria-label="Quoted post">
      <div className="quote-identity">
        <a className="quote-profile" href={`/${q.username}`} aria-label={`${q.name}'s profile`}>
          <UserAvatar name={q.name} username={q.username} image={q.image} />
        </a>
        <div className="quote-author">
          <a className="quote-profile" href={`/${q.username}`}>
            <strong>{q.name}</strong>
          </a>
          {q.isCaledonMember && <BadgeCheck size={14} className="quote-badge" aria-label="Verified Caledon member" />}
          <span className="quote-handle">@{q.username}</span>
        </div>
      </div>
      <a className="quote-source" href={q.url}>
        {q.parentUsername && <span className="quote-context">Replying to @{q.parentUsername}</span>}
        <p>{q.text || "Open quoted post"}</p>
        <time dateTime={created.toISOString()} title={`${time} GMT+7`}>
          {time}
        </time>
      </a>
    </aside>
  );
}
