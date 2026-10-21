const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function page(html, { stored, reducedMotion = false } = {}) {
  const dom = new JSDOM(read(html), { url: "https://mila.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  if (stored !== undefined) w.localStorage.setItem("mila-tema", stored);
  w.matchMedia = (query) => ({ matches: reducedMotion && /reduce/.test(query), addEventListener() {}, removeEventListener() {} });
  w.eval(read("theme.js"));
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  return w;
}
const meta = (w) => w.document.querySelector('meta[name="theme-color"]').getAttribute("content");

for (const html of ["index.html", "dashboard.html"]) {
  test(`${html} starts in the mila theme and ignores the system dark mode`, () => {
    const w = page(html);
    assert.equal(w.document.documentElement.getAttribute("data-theme"), "mila");
    assert.equal(meta(w), "#274034");
    const button = w.document.querySelector("[data-theme-toggle]");
    assert.ok(button, "theme button present");
    assert.equal(button.getAttribute("aria-label"), "Cambiar a modo noche");
  });

  test(`${html} toggles the theme, persists it and updates theme-color and the label`, () => {
    const w = page(html);
    const button = w.document.querySelector("[data-theme-toggle]");
    button.click();
    assert.equal(w.document.documentElement.getAttribute("data-theme"), "noche");
    assert.equal(w.localStorage.getItem("mila-tema"), "noche");
    assert.equal(meta(w), "#0D1410");
    assert.equal(button.getAttribute("aria-label"), "Cambiar a modo claro");
    button.click();
    assert.equal(w.document.documentElement.getAttribute("data-theme"), "mila");
    assert.equal(w.localStorage.getItem("mila-tema"), "mila");
    assert.equal(meta(w), "#274034");
  });

  test(`${html} restores a saved night choice before the page is painted`, () => {
    const w = page(html, { stored: "noche" });
    assert.equal(w.document.documentElement.getAttribute("data-theme"), "noche");
    assert.equal(meta(w), "#0D1410");
    assert.equal(w.document.querySelector("[data-theme-toggle]").getAttribute("aria-label"), "Cambiar a modo claro");
  });

  test(`${html} falls back to mila when the stored value is not a theme`, () => {
    const w = page(html, { stored: "rosa" });
    assert.equal(w.document.documentElement.getAttribute("data-theme"), "mila");
  });

  test(`${html} loads the theme script in the head before any stylesheet and theme.css first`, () => {
    const doc = new JSDOM(read(html)).window.document;
    const head = [...doc.head.children];
    const script = head.findIndex((el) => el.tagName === "SCRIPT" && el.getAttribute("src") === "theme.js");
    const firstSheet = head.findIndex((el) => el.tagName === "LINK" && el.getAttribute("rel") === "stylesheet" && /\.css$/.test(el.getAttribute("href")));
    assert.ok(script >= 0 && script < firstSheet, "theme.js runs before the first local stylesheet");
    assert.equal(head[firstSheet].getAttribute("href"), "theme.css");
    assert.equal(doc.querySelector('link[rel="icon"]').getAttribute("href"), "icons/favicon.png");
    assert.equal(doc.querySelector('link[rel="apple-touch-icon"]').getAttribute("href"), "icons/apple-touch-icon.png");
  });
}

test("theme switch animates colors only when motion is allowed", () => {
  const animated = page("index.html");
  animated.document.querySelector("[data-theme-toggle]").click();
  assert.ok(animated.document.documentElement.classList.contains("theme-switching"));
  const reduced = page("index.html", { reducedMotion: true });
  reduced.document.querySelector("[data-theme-toggle]").click();
  assert.equal(reduced.document.documentElement.classList.contains("theme-switching"), false);
  const css = read("theme.css");
  assert.match(css, /prefers-reduced-motion: no-preference[\s\S]*theme-switching/);
  assert.doesNotMatch(css, /transition:[^;]*\.(?:[3-9]\d*)s/);
});

test("brand logos sit in the client header, login and dashboard header", () => {
  const index = new JSDOM(read("index.html")).window.document;
  const header = index.querySelector(".topbar-brand img");
  assert.equal(header.getAttribute("src"), "brand/logo-crema.png");
  assert.equal(header.getAttribute("alt"), "Mila Café");
  assert.ok(header.getAttribute("width") && header.getAttribute("height"));
  assert.equal(index.querySelector(".topbar-brand").getAttribute("href"), "index.html");
  assert.equal(index.querySelector("#view-login .brand-logo-on-light").getAttribute("src"), "brand/logo-verde.png");
  assert.equal(index.querySelector("#view-login .brand-logo-on-dark").getAttribute("src"), "brand/logo-crema.png");
  const dash = new JSDOM(read("dashboard.html")).window.document;
  assert.equal(dash.querySelector(".dashboard-brand img").getAttribute("src"), "brand/logo-crema.png");
  for (const button of [index.querySelector("[data-theme-toggle]"), dash.querySelector("[data-theme-toggle]")]) {
    assert.ok(button.getAttribute("aria-label"));
  }
});

test("manifest and service worker ship the new identity", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.name, "Mila Café");
  assert.equal(manifest.short_name, "Mila Café");
  assert.equal(manifest.theme_color, "#274034");
  assert.equal(manifest.background_color, "#D8D5CC");
  const byPurpose = (purpose) => manifest.icons.filter((icon) => icon.purpose === purpose).map((icon) => icon.src);
  assert.deepEqual(byPurpose("any"), ["icons/icon-192.png", "icons/icon-512.png"]);
  assert.deepEqual(byPurpose("maskable"), ["icons/icon-maskable-512.png"]);
  const worker = read("service-worker.js");
  assert.doesNotMatch(worker, /mila-static-v4/);
  const listed = [...worker.matchAll(/"\.\/([^"]+)"/g)].map((match) => match[1]).filter(Boolean);
  for (const file of listed) assert.ok(fs.existsSync(path.join(root, file)), `${file} exists`);
  for (const file of ["theme.css", "theme.js", "brand/logo-verde.png", "brand/logo-crema.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon.png"]) {
    assert.ok(listed.includes(file), `${file} is precached`);
  }
});

test("no stylesheet or script writes a fixed color outside theme.css", () => {
  const colorLiteral = /#[0-9a-fA-F]{3,8}\b(?![\w-])|\brgba?\(|\bhsla?\(/;
  const files = fs.readdirSync(root).filter((name) => /\.(css|html)$/.test(name) && name !== "theme.css");
  for (const file of files) {
    const text = read(file).replace(/<meta[^>]*>/g, "");
    assert.doesNotMatch(text, colorLiteral, `${file} has a fixed color`);
  }
  for (const file of ["main.js", "menu-motion.js", "client-product-sheet.js", "dashboard.js", "dashboard-catalog.js", "dashboard-options.js", "dashboard-media.js", "pwa.js"]) {
    assert.doesNotMatch(read(file), /style\.(color|background)|#[0-9a-fA-F]{6}\b/, `${file} injects a color`);
  }
});

test("every var(--token) used by the stylesheets is defined", () => {
  const sheets = fs.readdirSync(root).filter((name) => name.endsWith(".css"));
  const all = sheets.map(read).join("\n");
  const defined = new Set([...all.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const runtime = new Set(["--tilt-x", "--tilt-y", "--tilt-scale"]);
  for (const [, token] of all.matchAll(/var\((--[a-z0-9-]+)/g)) {
    assert.ok(defined.has(token) || runtime.has(token), `${token} is defined`);
  }
});
