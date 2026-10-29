import fs from "node:fs/promises";
import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
await initWasm(await fs.readFile("node_modules/@resvg/resvg-wasm/index_bg.wasm"));
const font = await fs.readFile("node_modules/@fontsource/manrope/files/manrope-latin-400-normal.woff");
const svg = await satori(
  {
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: "64px 72px", background: "#fff", fontFamily: "Manrope", color: "#000" },
      children: [
        { type: "div", props: { style: { display: "flex", fontSize: 25, paddingBottom: 30, borderBottom: "1px solid #e5e5e5" }, children: "Caledon Forum" } },
        {
          type: "div",
          props: { style: { display: "flex", fontSize: 60, lineHeight: 1.2, marginTop: 52, maxWidth: 960 }, children: "Good conversations start with a little curiosity." },
        },
        { type: "div", props: { style: { display: "flex", marginTop: "auto", fontSize: 21, color: "#595959" }, children: "A place to ask, experiment, and learn together." } },
      ],
    },
  },
  { width: 1200, height: 630, fonts: [{ name: "Manrope", data: font, weight: 400 }] }
);
const renderer = new Resvg(svg);
const image = renderer.render();
await fs.writeFile("public/social.png", image.asPng());
image.free();
renderer.free();
console.log("Created public/social.png (1200 × 630).");
