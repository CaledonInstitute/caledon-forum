import { iconData, type IconName } from "./icon-data";
const cache = new Map<string, string>();
/** Only packaged Lucide geometry; never accepts arbitrary SVG or user markup. */
export function iconMarkup(name: IconName, size = 24, stroke = 2, filled = false) {
  const key = `${name}:${size}:${stroke}:${filled}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const escape = (value: string | number) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const nodes = iconData[name]
    .map(
      ([tag, attributes]) =>
        `<${tag} ${Object.entries(attributes)
          .map(([attr, value]) => `${attr}="${escape(value)}"`)
          .join(" ")}></${tag}>`
    )
    .join("");
  const result = `<svg xmlns="http://www.w3.org/2000/svg" width="${escape(size)}" height="${escape(size)}" viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="${escape(stroke)}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="lucide lucide-${name}">${nodes}</svg>`;
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
export const postIcons = {
  reply: iconMarkup("message-circle", 17, 1.6),
  like: iconMarkup("heart", 17, 1.6),
  liked: iconMarkup("heart", 17, 1.6, true),
  link: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg>',
  eye: iconMarkup("eye", 17, 1.6),
  more: iconMarkup("ellipsis", 19, 1.6),
};
