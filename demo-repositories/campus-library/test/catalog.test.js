import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilitySummary, loadCatalog, searchBooks } from "../src/catalog.js";

test("the catalogue loads the books of data/books.json", async () => {
  const books = await loadCatalog();
  assert.equal(books.length, 8);
  assert.ok(books.every((book) => book.id && book.title && book.author));
});

test("search matches title or author, case-insensitive, sorted by title", async () => {
  const books = await loadCatalog();
  assert.deepEqual(searchBooks(books, { query: "fowler" }).map((b) => b.id), ["bk-006"]);
  assert.deepEqual(searchBooks(books, { query: "CODE" }).map((b) => b.id), ["bk-001"]);
  const all = searchBooks(books);
  assert.equal(all.length, 8);
  assert.deepEqual(all.map((b) => b.title), [...all.map((b) => b.title)].sort((a, b) => a.localeCompare(b)));
});

test("availability summary counts available and on-loan books", async () => {
  assert.deepEqual(availabilitySummary(await loadCatalog()), { total: 8, available: 5, onLoan: 3 });
});
