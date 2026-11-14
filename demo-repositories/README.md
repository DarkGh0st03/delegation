# Demo repositories

Two small projects to show the system on repositories other than
`iam-console-poc`. Each folder is meant to become its **own** GitHub
repository of the Engineer's account; the console then imports it into Gitea.

| Project | What it is | Staging ("App") | Specialists a requirement typically needs |
| --- | --- | --- | --- |
| `campus-library` | Web catalogue: Node http server (`server.js`, `src/`), web page (`public/`), data (`data/books.json`), `README.md`, `Dockerfile`, tests (`test/`) | Web interface detected: "Pubblica l'app" | Backend, Frontend, Data, Docs, DevOps, Test |
| `unit-convert` | Library without user interface (`src/convert.js`, tests) | "Interfaccia non disponibile" | Backend, Docs, Test |

Both have no external dependencies (`npm ci` installs nothing, `npm test`
runs Node's built-in test runner), so the Runner's default npm profile works
as is.

## Publish them on GitHub

From a terminal (Ubuntu/WSL), for each project (replace the account if needed):

```bash
cp -r demo-repositories/campus-library ~/campus-library
cd ~/campus-library
git init -b main && git add . && git commit -m "Campus Library"
```

Create an empty repository `campus-library` on github.com (no README), then:

```bash
git remote add origin https://github.com/DarkGh0st03/campus-library.git
git push -u origin main
```

Repeat for `unit-convert`, then import both from the console (Importa da GitHub).

## Requirements to try

On `campus-library` (each one asks for work outside Backend/Frontend):

1. *Every book has a genre. Add the genre to all books in the data, let the
   API filter books by genre (parameter `genre`), add a genre selector to the
   page and document the new filter in the README.*
   → Data (`data/books.json`), Backend (`src/catalog.js`, `server.js`),
   Frontend (`public/`), Docs (`README.md`), Test (`test/`).
2. *Make the maximum number of results returned by the API configurable with
   the environment variable `MAX_RESULTS` (default 50), set it in the
   Dockerfile and document it in the README.*
   → Backend, DevOps (`Dockerfile`), Docs, Test — no Frontend.

On `unit-convert`:

3. *Add weight conversions (g, kg, lb, oz) and document them in the README.*
   → Backend, Docs, Test — no Frontend, Data or DevOps.
