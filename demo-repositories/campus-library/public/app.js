const list = document.getElementById("books");
const summary = document.getElementById("summary");
const query = document.getElementById("query");

function bookItem(book) {
  const item = document.createElement("li");
  item.className = "book";
  const text = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = book.title;
  const meta = document.createElement("span");
  meta.textContent = `${book.author} · ${book.year}`;
  text.append(title, meta);
  const badge = document.createElement("span");
  badge.className = book.available ? "badge available" : "badge on-loan";
  badge.textContent = book.available ? "Available" : "On loan";
  item.append(text, badge);
  return item;
}

async function refresh() {
  const response = await fetch(`/api/books?q=${encodeURIComponent(query.value)}`);
  const data = await response.json();
  list.replaceChildren(...data.books.map(bookItem));
  summary.textContent =
    `${data.summary.total} books · ${data.summary.available} available · ${data.summary.onLoan} on loan`;
  if (!data.books.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No books match your search.";
    list.append(empty);
  }
}

document.getElementById("search-form").addEventListener("submit", (event) => event.preventDefault());
query.addEventListener("input", refresh);
refresh().catch(() => { summary.textContent = "The catalogue is not available right now."; });
