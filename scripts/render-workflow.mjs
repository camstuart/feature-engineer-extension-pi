// Render docs/workflow.mmd → docs/workflow.svg via headless Chrome.
// Mermaid's layout APIs (getBBox etc.) need a real DOM, so we use puppeteer.
import { readFileSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer";

const SOURCE = "docs/workflow.mmd";
const OUTPUT = "docs/workflow.svg";

const mermaidSource = readFileSync(SOURCE, "utf8");

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 24px; background: white; }
</style></head>
<body><pre class="mermaid">${mermaidSource}</pre>
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: true, theme: "default" });
  window.__mermaidReady = true;
</script></body></html>`;

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 2 });

await page.setContent(html, { waitUntil: "networkidle0" });
// Wait until mermaid has rendered the diagram
await page.waitForFunction(
  () => document.querySelector(".mermaid svg") !== null,
  { timeout: 30000 },
);

// Extract the rendered SVG. Strip the default <?xml ...?> prolog if present
// (mermaid includes one which is fine inline but unnecessary in our use).
const svg = await page.evaluate(() => {
  const el = document.querySelector(".mermaid svg");
  return el ? el.outerHTML : null;
});

if (!svg) {
  console.error("Mermaid did not render an SVG");
  await browser.close();
  process.exit(1);
}

// Mermaid emits XHTML content inside <foreignObject> with bare <br> tags.
// When the SVG is saved as a standalone file, Chrome's strict XML parser
// rejects these (they need to be self-closed as <br/>). Rewrite them so
// the SVG is valid as a standalone XML document.
const fixed = svg.replace(/<br\s*>/g, "<br/>").replace(/<hr\s*>/g, "<hr/>");

writeFileSync(OUTPUT, fixed);
console.log(`OK: wrote ${OUTPUT} (${fixed.length} bytes)`);
await browser.close();