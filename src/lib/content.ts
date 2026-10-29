export const MAX_CHARACTERS = 25_000;
export const countCharacters = (value: string) => Array.from(value).length;
export function validateBody(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Write something before publishing.");
  if (countCharacters(value) > MAX_CHARACTERS) throw new Error("Keep your post within 25,000 characters.");
  return value.trim();
}
export function plainText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function excerpt(value: string, length = 160): string {
  const chars = Array.from(plainText(value));
  if (chars.length <= length) return chars.join("");
  const cut = chars.slice(0, length - 1).join("");
  const space = cut.lastIndexOf(" ");
  return (space > length * 0.65 ? cut.slice(0, space) : cut) + "…";
}
export function threadTitle(body: string, previewTitle?: string, author = "Caledon member") {
  return excerpt(
    plainText(body)
      .replace(/https?:\/\/\S+/g, "")
      .trim() ||
      previewTitle ||
      `A conversation by ${author}`,
    70
  );
}
export function youtubeId(value: string): string | null {
  try {
    const u = new URL(value);
    let id: string | null = null;
    if (u.hostname === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(u.hostname)) id = u.searchParams.get("v") || u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1] || null;
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
export const PAGE_SIZE = 20;
export function pageNumber(url: URL) {
  return Math.min(100000, Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1)));
}
