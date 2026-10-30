import { readFile, writeFile } from "node:fs/promises";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
await initWasm(await readFile("node_modules/@resvg/resvg-wasm/index_bg.wasm"));
const svg = await readFile("public/favicon.svg", "utf8");
for (const size of [180, 192, 512]) {
  const renderer = new Resvg(svg, { fitTo: { mode: "width", value: size } });
  const image = renderer.render();
  await writeFile(`public/icon-${size}.png`, image.asPng());
  image.free();
  renderer.free();
}
