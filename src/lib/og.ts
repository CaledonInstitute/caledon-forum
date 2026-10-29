import layoutWasm from "satori/layout.wasm?module";
import type { ReactElement } from "react";
import satori, { init } from "../../.astro/satori-worker.mjs";
let engine: Promise<void> | undefined;
export async function socialSvg(font: ArrayBuffer, title: string, author?: string) {
  engine ||= init(layoutWasm);
  await engine;
  return satori(
    {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: "64px 72px", background: "#fff", color: "#000", fontFamily: "Manrope" },
        children: [
          { type: "div", props: { style: { display: "flex", fontSize: 25, borderBottom: "1px solid #e5e5e5", paddingBottom: 30 }, children: "Caledon Forum" } },
          {
            type: "div",
            props: { style: { display: "flex", fontSize: 54, lineHeight: 1.25, letterSpacing: -1.5, marginTop: 48, maxHeight: 290, overflow: "hidden" }, children: title },
          },
          {
            type: "div",
            props: {
              style: { display: "flex", marginTop: "auto", fontSize: 21, color: "#595959" },
              children: author ? `A conversation by ${author}` : "A place to ask, experiment, and learn together.",
            },
          },
        ],
      },
    } as ReactElement,
    { width: 1200, height: 630, fonts: [{ name: "Manrope", data: font, weight: 400, style: "normal" }] }
  );
}
