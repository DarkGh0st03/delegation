import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
import { loadCatalog } from "../src/catalog.js";

async function withServer(run) {
  const server = createApp(await loadCatalog());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("GET /api/books returns the books and the summary", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/books?q=tanenbaum`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.books.map((b) => b.id), ["bk-007"]);
    assert.deepEqual(body.summary, { total: 1, available: 1, onLoan: 0 });
  });
});

test("the web page and its assets are served; unknown paths are 404", async () => {
  await withServer(async (base) => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>Campus Library<\/title>/);
    assert.equal((await fetch(`${base}/app.js`)).status, 200);
    assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
    assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  });
});
