export type MentionUser = { name: string; username: string; image: string | null };

export function activeMention(body: string, caret: number) {
  const match = /(?:^|[\s([{])@([a-zA-Z_][a-zA-Z0-9_]{0,29})?$/.exec(body.slice(0, caret));
  return match ? { start: caret - (match[1]?.length || 0) - 1, end: caret, query: match[1] || "" } : null;
}
