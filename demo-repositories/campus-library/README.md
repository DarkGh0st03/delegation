# Campus Library

Small web catalogue of the campus library: search the books by title or
author and see which ones are available or on loan.

## Run

Requires Node.js 22 (no external dependencies).

```bash
npm start
```

Then open http://127.0.0.1:3000. The server reads `PORT` (default `3000`)
and `HOST` (default `127.0.0.1`).

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/books?q=<text>` | Books whose title or author contains `q`, sorted by title, with a summary (`total`, `available`, `onLoan`). |

## Data

The catalogue is in `data/books.json`: one object per book with `id`,
`title`, `author`, `year` and `available`.

## Tests

```bash
npm test
```

## Docker

```bash
docker build -t campus-library .
docker run -p 3000:3000 campus-library
```
