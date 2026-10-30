import layoutWasm from "satori/layout.wasm?module";
import type { ReactElement } from "react";
import satori, { init } from "../../.astro/satori-worker.mjs";
import { cardText, truncateCardText, type PostCardData, type ProfileCardData } from "./og-card";
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
export async function socialSvg(fonts: CardFonts, data: PostCardData, avatar?: string, media?: string) {
  await initializeLayout();
  const name = Array.from(data.name).slice(0, 26).join("") + (Array.from(data.name).length > 26 ? "…" : "");
  const date = new Date(data.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
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
            { display: "flex", width: media ? 652 : 1104, fontSize: 32, lineHeight: 1.14, overflow: "hidden", lineClamp: media ? 7 : 9 },
            cardText(data.text, !!media) || (media ? "" : "View this post on Caledon Forum.")
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
