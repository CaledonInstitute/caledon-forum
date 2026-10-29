import { BadgeCheck } from "lucide-react";
import type { QuotedPost } from "../lib/types";

export default function QuoteCard({ quote: q }: { quote: QuotedPost }) {
  if (q.unavailable)
    return (
      <aside className="quote-card quote-unavailable" aria-label="Unavailable quoted post">
        <p>This quoted post is no longer available.</p>
      </aside>
    );
  const created = new Date(q.createdAt);
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "Asia/Jakarta" }).format(created);
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(created);
  return (
    <aside className="quote-card" aria-label="Quoted post">
      <div className="quote-identity">
        <a className="quote-profile" href={`/${q.username}`} aria-label={`${q.name}'s profile`}>
          <span className="avatar" aria-hidden="true">
            {q.name.trim().slice(0, 1).toUpperCase() || "C"}
            {q.image && (
              <img
                src={`/api/avatar/${encodeURIComponent(q.username)}`}
                alt=""
                width={30}
                height={30}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={(event) => {
                  event.currentTarget.style.opacity = "0";
                }}
              />
            )}
          </span>
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
        <time dateTime={created.toISOString()} title={`${date} ${clock} GMT+7`}>
          {date} {clock}
        </time>
      </a>
    </aside>
  );
}
