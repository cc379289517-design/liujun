import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ORIGIN = process.env.ORIGIN ?? "http://localhost:4123";
const OUT_DIR = process.env.OUT_DIR ?? "/Users/lj/Desktop/1233/static-html";

const ROUTES = [
  "/",
  "/admin",
  "/assistant",
  "/leader",
  "/photographer",
  "/photographer/book",
  "/snake",
];

function outPathForRoute(route) {
  if (route === "/") return path.join(OUT_DIR, "index.html");
  const cleaned = route.replace(/^\/+/, "").replace(/\/+$/, "");
  return path.join(OUT_DIR, cleaned, "index.html");
}

function outPathForAsset(assetPath) {
  // assetPath like "/_next/static/..."
  const cleaned = assetPath.replace(/^\/+/, "");
  return path.join(OUT_DIR, cleaned);
}

async function ensureDirForFile(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
  return await res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function extractLocalAssetsFromHtml(html) {
  const assets = new Set();
  // Grab common asset URLs referenced by Next HTML.
  const re = /(src|href)=["'](\/_next\/[^"'?#]+(?:\?[^"'#]*)?)["']/g;
  let m;
  while ((m = re.exec(html))) {
    const url = m[2];
    const pathname = url.split("?")[0];
    assets.add(pathname);
  }
  // favicon / manifest / robots etc (if any)
  const re2 = /(src|href)=["'](\/(favicon\.ico|manifest\.json|robots\.txt|sitemap\.xml|apple-touch-icon[^"'?#]*))["']/g;
  while ((m = re2.exec(html))) {
    assets.add(m[2]);
  }
  return [...assets];
}

function rewriteHtmlForOffline(html) {
  // Make root-absolute local assets relative so file:// opening works.
  return html
    .replaceAll('src="/_next/', 'src="./_next/')
    .replaceAll("src='/_next/", "src='./_next/")
    .replaceAll('href="/_next/', 'href="./_next/')
    .replaceAll("href='/_next/", "href='./_next/")
    .replaceAll('href="/favicon.ico"', 'href="./favicon.ico"')
    .replaceAll("href='/favicon.ico'", "href='./favicon.ico'")
    .replaceAll('href="/manifest.json"', 'href="./manifest.json"')
    .replaceAll("href='/manifest.json'", "href='./manifest.json'");
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const allAssets = new Set();

  for (const route of ROUTES) {
    const url = new URL(route, ORIGIN).toString();
    const html = await fetchText(url);
    const assets = extractLocalAssetsFromHtml(html);
    assets.forEach((a) => allAssets.add(a));

    const rewritten = rewriteHtmlForOffline(html);
    const outFile = outPathForRoute(route);
    await ensureDirForFile(outFile);
    await writeFile(outFile, rewritten, "utf8");
    process.stdout.write(`Saved ${route} -> ${outFile}\n`);
  }

  for (const assetPath of allAssets) {
    const url = new URL(assetPath, ORIGIN).toString();
    const buf = await fetchBuffer(url);
    const outFile = outPathForAsset(assetPath);
    await ensureDirForFile(outFile);
    await writeFile(outFile, buf);
    process.stdout.write(`Asset ${assetPath} -> ${outFile}\n`);
  }

  process.stdout.write(`Done. Open ${path.join(OUT_DIR, "index.html")}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

