import layoutWasm from "satori/layout.wasm?module";
import type { ReactElement } from "react";
import satori, { init } from "../../.astro/satori-worker.mjs";
import { cardText, type PostCardData } from "./og-card";
let engine: Promise<void> | undefined;
const node = (type: string, style: Record<string, unknown>, children?: unknown, extra = {}) => ({ type, props: { style, children, ...extra } });
export async function socialSvg(fonts: { regular: ArrayBuffer; bold: ArrayBuffer; emoji: ArrayBuffer }, data: PostCardData, avatar?: string, media?: string) {
  engine ||= init(layoutWasm).catch((error) => {
    engine = undefined;
    throw error;
  });
  await engine;
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
          { display: "flex", position: "absolute", top: 542, left: 48, width: 1104, paddingTop: 18, borderTop: "1px solid #E5E5E5", fontSize: 17, color: "#595959" },
          data.host
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
