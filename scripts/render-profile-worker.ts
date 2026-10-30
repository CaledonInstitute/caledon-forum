// Isolated diagnostic Worker. No production data, bindings, or authentication.
import { markdown } from "../src/lib/markdown";
const sample =
  "## Research note\n\n**Markdown** and a [source](https://example.com). @alice\n\n```python\nfor i in range(10):\n    print(i * i)\n```\n\n$E=mc^2$\n\n$$\\frac{1}{3}$$\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n";
const long = sample.repeat(Math.ceil(25_000 / sample.length)).slice(0, 25_000);
async function render(request: Request) {
  const path = new URL(request.url).pathname;
  if (path === "/health") return Response.json({ ok: true });
  if (!["/card", "/feed", "/detail"].includes(path)) return new Response(null, { status: 404 });
  const count = path === "/feed" ? 20 : 1;
  let bytes = 0;
  for (let i = 0; i < count; i++) bytes += (await markdown(path === "/detail" ? long : sample)).length;
  return Response.json({ variant: path, count, inputLength: path === "/detail" ? long.length : sample.length, outputLength: bytes });
}
export default {
  async fetch(request: Request) {
    return render(request);
  },
};
