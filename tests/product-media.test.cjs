const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
function media() {
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "product-media.js"), "utf8"), ctx);
  return ctx.window.MilaMedia;
}
test("gallery order overrides the legacy main image; empty gallery falls back", () => {
  const m = media();
  assert.deepEqual(Array.from(m.urls({ image_url: "old", images: [{id:"b",url:"second",orden:2},{id:"a",url:"first",orden:0}] })), ["first", "second"]);
  assert.deepEqual(Array.from(m.urls({ image_url: "old", images: [] })), ["old"]);
  assert.equal(m.urls({}).length, 0);
});
test("carousel shows indicators only for multiple images and escapes content", () => {
  const m = media();
  assert.doesNotMatch(m.carousel({ name: "Café", image_url: "one" }), /gallery-dots/);
  const html = m.carousel({ name: '<script>', images: [{id:"a",url:"one",orden:0},{id:"b",url:"two",orden:1}] });
  assert.match(html, /gallery-dots/);
  assert.equal((html.match(/data-photo-index=/g) || []).length, 2);
  assert.doesNotMatch(html, /<script>/);
});
test("gallery errors are explicit and never fall back silently", async () => {
  const m = media();
  const query = { select(){return this;}, in(){return this;}, order(){return Promise.resolve({error:{message:"Permiso denegado"}});} };
  await assert.rejects(m.load({from(){return query;}}, ["product"]), /Permiso denegado/);
});
test("reject photos at or above 1 MB before Storage is contacted", async () => {
  await assert.rejects(media().upload({}, "product", {size:1000000}), /menos de 1 MB/);
});
