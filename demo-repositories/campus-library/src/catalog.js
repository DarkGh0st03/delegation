import { readFile } from "node:fs/promises";

const DATA_FILE = new URL("../data/books.json", import.meta.url);

/** Reads the catalogue from data/books.json. */
export async function loadCatalog(file = DATA_FILE) {
  const books = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(books)) {
    throw new Error("data/books.json must contain an array of books");
  }
  return books;
}

/**
 * Books whose title or author contains the query (case-insensitive),
 * sorted by title. An empty query returns the whole catalogue.
 */
export function searchBooks(books, { query = "" } = {}) {
  const needle = query.trim().toLowerCase();
  return books
    .filter(
      (book) =>
        !needle ||
        book.title.toLowerCase().includes(needle) ||
        book.author.toLowerCase().includes(needle)
    )
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Summary shown above the list. */
export function availabilitySummary(books) {
  const available = books.filter((book) => book.available).length;
  return { total: books.length, available, onLoan: books.length - available };
}
