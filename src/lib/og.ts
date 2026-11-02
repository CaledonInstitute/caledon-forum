import layoutWasm from "satori/layout.wasm?module";
import type { ReactElement } from "react";
import type { SatoriNode } from "satori";
import satori, { init } from "../../.astro/satori-worker.mjs";
import { truncateCardText, type PostCardData, type ProfileCardData } from "./og-card";
import { cardMarkdown } from "./og-markdown";
import { postTime } from "./post-time";
let engine: Promise<void> | undefined;
const node = (type: string, style: Record<string, unknown>, children?: unknown, extra = {}) => ({ type, props: { style, children, ...extra } });
async function initializeLayout() {
  engine ||= init(layoutWasm).catch((error) => {
    engine = undefined;
    throw error;
  });
  await engine;
}
type CardFonts = { regular: ArrayBuffer; bold: ArrayBuffer; emoji: ArrayBuffer };
const fontOptions = (fonts: CardFonts) => [
  { name: "Manrope", data: fonts.regular, weight: 400 as const, style: "normal" as const },
  { name: "Manrope", data: fonts.bold, weight: 700 as const, style: "normal" as const },
  { name: "NotoEmoji", data: fonts.emoji, weight: 400 as const, style: "normal" as const },
];
async function fitMarkdown(fonts: CardFonts, data: PostCardData, limit: number, size: number, width: number, height: number) {
  const formatted = cardMarkdown(data.markdown ?? data.text, limit, size, data.omittedImage);
  if (!formatted.hasContent) return formatted;
  const content = formatted.content as ReactElement<{ style: Record<string, unknown>; children: ReactElement[] }>;
  const blocks = content.props.children.map((child, i) => ({ ...child, key: `markdown-${i}` }));
  const bottoms = new Map<string, number>();
  // Measure actual line wrapping before selecting whole blocks for the small card.
  await satori(
    { ...content, props: { ...content.props, style: { ...content.props.style, width, fontFamily: "Manrope, NotoEmoji" }, children: blocks } },
    {
      width,
      fonts: fontOptions(fonts),
      embedFont: false,
      onNodeDetected: (n: SatoriNode) => {
        if (typeof n.key === "string" && n.key.startsWith("markdown-")) bottoms.set(n.key, n.top + n.height);
      },
    }
  );
  if (blocks.every((block) => (bottoms.get(String(block.key)) || 0) <= height)) return formatted;
  const overflow = blocks.findIndex((block) => (bottoms.get(String(block.key)) || 0) > height - size * 1.4 - 12);
  if (overflow < 0) return formatted;
  const kept = blocks.slice(0, overflow);
  if (!kept.length) {
    // A single long paragraph still gets a useful excerpt with inline styles intact.
    const first = blocks[0] as ReactElement<{ style: Record<string, unknown>; children: unknown }>;
    kept.push({
      ...first,
      props: { ...first.props, style: { ...first.props.style, lineClamp: Math.max(1, Math.floor((height - 48) / (size * 1.5))), maxHeight: height - 48, overflow: "hidden" } },
    } as (typeof blocks)[number]);
  }
  kept.push(node("div", { display: "flex", fontSize: size, color: "#595959", flexShrink: 0 }, "…") as (typeof blocks)[number]);
  return { ...formatted, content: { ...content, props: { ...content.props, children: kept } }, truncated: true };
}
export async function storySvg(fonts: CardFonts, data: PostCardData, avatar?: string, media?: string) {
  await initializeLayout();
  const formatted = await fitMarkdown(fonts, data, media ? 650 : 1400, data.text.length > 600 ? 32 : 40, 920, media ? 640 : 1140);
  const date = postTime(data.createdAt);
  return satori(
    node(
      "div",
      {
        display: "flex",
        flexDirection: "column",
        width: 1080,
        height: 1920,
        position: "relative",
        background: "#ffffff",
        color: "#000000",
        fontFamily: "Manrope, NotoEmoji",
      },
      [
        node("div", { display: "flex", color: "#1d70e8", fontSize: 32, fontWeight: 700, position: "absolute", top: 120, left: 80, width: 920, height: 50 }, "Caledon Forum"),
        node("div", { display: "flex", alignItems: "center", position: "absolute", top: 280, left: 80, width: 920, height: 100 }, [
          avatar
            ? node("img", { width: 88, height: 88, borderRadius: 44, objectFit: "cover", flexShrink: 0 }, undefined, { src: avatar })
            : node(
                "div",
                { display: "flex", width: 88, height: 88, borderRadius: 44, background: "#f7f7f7", fontSize: 36, alignItems: "center", justifyContent: "center", flexShrink: 0 },
                Array.from(data.name.trim())[0] || "?"
              ),
          node("div", { display: "flex", flexDirection: "column", marginLeft: 24, width: 808, flexShrink: 1 }, [
            node("div", { display: "flex", alignItems: "center", fontSize: 36, fontWeight: 700 }, [
              node(
                "div",
                { display: "flex", maxWidth: data.member ? 740 : 808, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" },
                truncateCardText(data.name, 36)
              ),
              data.member
                ? node(
                    "svg",
                    { width: 32, height: 32, marginLeft: 12, flexShrink: 0 },
                    [
                      node("circle", {}, undefined, { cx: 12, cy: 12, r: 12, fill: "#1D70E8" }),
                      node("path", {}, undefined, { d: "M7 12l3 3 7-7", fill: "none", stroke: "#FFFFFF", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }),
                    ],
                    { viewBox: "0 0 24 24" }
                  )
                : null,
            ]),
            node("div", { display: "flex", fontSize: 26, color: "#595959", marginTop: 6 }, data.username ? `@${data.username}` : "Deleted account"),
          ]),
        ]),
        data.parent ? node("div", { display: "flex", fontSize: 26, color: "#595959", position: "absolute", top: 400, left: 80, width: 920 }, `Replying to @${data.parent}`) : null,
        node("div", { display: "flex", flexDirection: "column", position: "absolute", top: data.parent ? 464 : 420, left: 80, width: 920, height: 1160, overflow: "hidden" }, [
          node(
            "div",
            {
              display: "flex",
              flexDirection: "column",
              fontSize: data.text.length > 600 ? 32 : 40,
              lineHeight: 1.45,
              width: 920,
              maxHeight: media ? 640 : 1140,
              flexShrink: 0,
              overflow: "hidden",
              wordBreak: "break-word",
            },
            formatted.hasContent ? formatted.content : media ? "" : "View this post on Caledon Forum."
          ),
          media ? node("img", { width: 920, height: 480, objectFit: "contain", marginTop: 36, flexShrink: 0 }, undefined, { src: media }) : null,
        ]),
        node(
          "div",
          {
            display: "flex",
            flexDirection: "column",
            position: "absolute",
            top: 1680,
            left: 80,
            width: 920,
            borderTop: "2px solid #e5e5e5",
            paddingTop: 28,
            color: "#595959",
            fontSize: 24,
            flexShrink: 0,
          },
          [
            node("div", { display: "flex", marginBottom: 12 }, date),
            node("div", { display: "flex", color: "#1d70e8" }, `${data.host}/p/${data.id}`),
            data.member ? node("div", { display: "flex", marginTop: 12 }, "Member of Caledon Institute") : null,
            formatted.truncated ? node("div", { display: "flex", marginTop: 12 }, "Continue reading on Caledon Forum") : null,
          ]
        ),
      ]
    ) as ReactElement,
    {
      width: 1080,
      height: 1920,
      fonts: [
        { name: "Manrope", data: fonts.regular, weight: 400, style: "normal" },
        { name: "Manrope", data: fonts.bold, weight: 700, style: "normal" },
        { name: "NotoEmoji", data: fonts.emoji, weight: 400, style: "normal" },
      ],
    }
  );
}
export async function socialSvg(fonts: CardFonts, data: PostCardData, avatar?: string, media?: string) {
  await initializeLayout();
  const name = Array.from(data.name).slice(0, 26).join("") + (Array.from(data.name).length > 26 ? "…" : "");
  const date = postTime(data.createdAt);
  const formatted = await fitMarkdown(fonts, data, media ? 240 : 540, 32, media ? 652 : 1104, 330);
  return satori(
    node(
      "div",
      {
        display: "flex",
        flexDirection: "column",
        width: 1200,
        height: 630,
        position: "relative",
        background: "#FFFFFF",
        color: "#000000",
        fontFamily: "Manrope, NotoEmoji",
      },
      [
        node("div", { display: "flex", position: "absolute", top: 48, left: 48, width: 1104, alignItems: "center", height: 76 }, [
          avatar
            ? node("img", { width: 64, height: 64, borderRadius: 32, objectFit: "cover" }, undefined, { src: avatar })
            : node(
                "div",
                { display: "flex", width: 64, height: 64, borderRadius: 32, background: "#F7F7F7", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 700 },
                Array.from(data.name.trim())[0] || "?"
              ),
          node("div", { display: "flex", flexDirection: "column", marginLeft: 18, width: 780, flexShrink: 0 }, [
            node("div", { display: "flex", alignItems: "center", fontSize: 28, fontWeight: 700 }, [
              name,
              data.member
                ? node(
                    "svg",
                    { width: 24, height: 24, marginLeft: 10, flexShrink: 0 },
                    [
                      node("circle", {}, undefined, { cx: 12, cy: 12, r: 12, fill: "#1D70E8" }),
                      node("path", {}, undefined, { d: "M7 12l3 3 7-7", fill: "none", stroke: "#FFFFFF", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }),
                    ],
                    { viewBox: "0 0 24 24" }
                  )
                : null,
            ]),
            node("div", { display: "flex", fontSize: 18, color: "#595959", marginTop: 4 }, `@${data.username} · ${date}`),
          ]),
          node("div", { display: "flex", width: 242, justifyContent: "flex-end", fontSize: 21, fontWeight: 700 }, "Caledon Forum"),
        ]),
        node("div", { display: "flex", position: "absolute", top: 130, left: 130, height: 32, fontSize: 18, color: "#595959" }, data.parent ? `Replying to @${data.parent}` : ""),
        node("div", { display: "flex", position: "absolute", top: 180, left: 48, width: 1104, height: 330, gap: 32, overflow: "hidden", flexShrink: 0 }, [
          node(
            "div",
            { display: "flex", flexDirection: "column", width: media ? 652 : 1104, fontSize: 32, lineHeight: 1.4, overflow: "hidden" },
            formatted.hasContent ? formatted.content : media ? "" : "View this post on Caledon Forum."
          ),
          media ? node("img", { width: 420, height: 330, borderRadius: 12, objectFit: "cover", objectPosition: "center", flexShrink: 0 }, undefined, { src: media }) : null,
        ]),
        node(
          "div",
          {
            display: "flex",
            position: "absolute",
            top: 542,
            left: 48,
            width: 1104,
            paddingTop: 18,
            borderTop: "1px solid #E5E5E5",
            fontSize: 17,
            color: "#595959",
            justifyContent: "space-between",
          },
          [node("div", { display: "flex" }, data.host), data.member ? node("div", { display: "flex" }, "Member of Caledon Institute") : null]
        ),
      ]
    ) as ReactElement,
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Manrope", data: fonts.regular, weight: 400, style: "normal" },
        { name: "Manrope", data: fonts.bold, weight: 700, style: "normal" },
        { name: "NotoEmoji", data: fonts.emoji, weight: 400, style: "normal" },
      ],
    }
  );
}

export async function profileSocialSvg(fonts: CardFonts, data: ProfileCardData, avatar?: string, cover?: string) {
  await initializeLayout();
  return satori(
    node(
      "div",
      { display: "flex", flexDirection: "column", width: 1200, height: 630, position: "relative", background: "#FFFFFF", color: "#000000", fontFamily: "Manrope, NotoEmoji" },
      [
        node(
          "div",
          { display: "flex", position: "absolute", top: 0, left: 0, width: 1200, height: 220, background: "#F7F7F7", overflow: "hidden" },
          cover ? node("img", { width: 1200, height: 220, objectFit: "cover", objectPosition: "center" }, undefined, { src: cover }) : null
        ),
        node("div", { display: "flex", position: "absolute", top: 168, left: 42, width: 108, height: 108, padding: 6, borderRadius: 54, background: "#FFFFFF" }, [
          avatar
            ? node("img", { width: 96, height: 96, borderRadius: 48, objectFit: "cover" }, undefined, { src: avatar })
            : node(
                "div",
                { display: "flex", width: 96, height: 96, borderRadius: 48, background: "#F7F7F7", alignItems: "center", justifyContent: "center", fontSize: 40, fontWeight: 700 },
                Array.from(data.name.trim())[0] || "?"
              ),
        ]),
        node("div", { display: "flex", position: "absolute", top: 294, left: 48, width: 1104, height: 54, alignItems: "center" }, [
          node(
            "div",
            { display: "flex", maxWidth: 1050, fontSize: 40, fontWeight: 700, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" },
            truncateCardText(data.name, 42)
          ),
          data.member
            ? node(
                "svg",
                { width: 28, height: 28, marginLeft: 12, flexShrink: 0 },
                [
                  node("circle", {}, undefined, { cx: 14, cy: 14, r: 14, fill: "#1D70E8" }),
                  node("path", {}, undefined, { d: "M8 14l4 4 8-8", fill: "none", stroke: "#FFFFFF", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }),
                ],
                { viewBox: "0 0 28 28" }
              )
            : null,
        ]),
        node("div", { display: "flex", position: "absolute", top: 352, left: 48, width: 1104, fontSize: 22, color: "#595959" }, `@${data.username}`),
        data.member ? node("div", { display: "flex", position: "absolute", top: 390, left: 48, width: 1104, fontSize: 18, color: "#595959" }, "Member of Caledon Institute") : null,
        node(
          "div",
          {
            display: "flex",
            position: "absolute",
            top: data.member ? 432 : 404,
            left: 48,
            width: 1104,
            height: data.member ? 80 : 108,
            fontSize: 26,
            lineHeight: 1.35,
            overflow: "hidden",
            lineClamp: data.member ? 2 : 3,
            wordBreak: "break-word",
          },
          truncateCardText(data.bio, 240)
        ),
        node(
          "div",
          {
            display: "flex",
            position: "absolute",
            top: 558,
            left: 48,
            width: 1104,
            borderTop: "1px solid #E5E5E5",
            paddingTop: 20,
            justifyContent: "space-between",
            alignItems: "center",
          },
          [node("div", { display: "flex", fontSize: 21, fontWeight: 700 }, "Caledon Forum"), node("div", { display: "flex", fontSize: 17, color: "#595959" }, data.host)]
        ),
      ]
    ) as ReactElement,
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Manrope", data: fonts.regular, weight: 400, style: "normal" },
        { name: "Manrope", data: fonts.bold, weight: 700, style: "normal" },
        { name: "NotoEmoji", data: fonts.emoji, weight: 400, style: "normal" },
      ],
    }
  );
}
