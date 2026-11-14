/**
 * Staging detection: from the files of a repository's main, decide whether
 * it has a web user interface and PROPOSE how to build and start it.
 *
 * Like the "framework detected" step of a real deployment platform, the
 * result is only a proposal: the Engineer confirms it (one click) or edits
 * it in the console. Nothing here executes repository code; only a few
 * small manifest files are read as data.
 */
import {validateStagingProfile} from "./staging.mjs";

const NODE_IMAGE = "node:22.15.0-bookworm";
const PYTHON_IMAGE = "python:3.12.7-slim";
const MAX_READS = 8;

const has = (deps, ...names) => names.some(n => Object.hasOwn(deps, n));
const proposal = (raw) => validateStagingProfile({version: 1, enabled: true, ...raw});
const web = (reason, profile, evidence) => ({interface: "web", reason, evidence, proposal: proposal(profile)});
const none = (reason, evidence, profile) => ({interface: "none", reason, evidence,
  ...(profile ? {proposal: proposal({...profile})} : {})});

function parseJson(text) { try { return JSON.parse(text); } catch { return undefined; } }

/** Node.js project (package.json at the root). */
function detectNode(pkg, files) {
  const deps = {...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {})};
  const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  const install = files.has("package-lock.json") ? "npm ci --include=dev --no-audit --no-fund"
    : "npm install --include=dev --no-audit --no-fund";
  const build = scripts.build ? `${install} && npm run build` : install;
  const evidence = ["package.json"];

  if (has(deps, "next"))
    return web("Applicazione Next.js", {image: NODE_IMAGE, build: `${install} && npx next build`,
      start: "npx next start -H 0.0.0.0 -p 3000", port: 3000}, evidence);
  if (has(deps, "@sveltejs/kit", "nuxt", "@remix-run/serve", "astro") && scripts.build && scripts.start)
    return web("Applicazione web con server di rendering", {image: NODE_IMAGE, build,
      start: "HOST=0.0.0.0 PORT=3000 npm start", port: 3000}, evidence);

  const ui = has(deps, "react", "react-dom", "vue", "svelte", "@angular/core", "solid-js", "preact", "lit");
  const server = has(deps, "express", "fastify", "koa", "@hapi/hapi", "hono", "@nestjs/core");
  const vite = has(deps, "vite");
  const html = files.has("index.html") || files.has("public/index.html");

  // A server that also serves a user interface (static files or a built UI).
  if (server && scripts.start && (ui || html || [...files].some(f => /^public\/.+\.html$/u.test(f))))
    return web("Server Node.js con interfaccia web", {image: NODE_IMAGE, build,
      start: "HOST=0.0.0.0 PORT=3000 npm start", port: 3000}, evidence);
  // A front-end built with Vite: serve the build with vite preview.
  if (vite && (ui || html))
    return web("Interfaccia web costruita con Vite", {image: NODE_IMAGE,
      build: `${install} && ${scripts.build ? "npm run build" : "npx vite build"}`,
      start: "npx vite preview --host 0.0.0.0 --port 4173 --strictPort", port: 4173}, evidence);
  if (ui && scripts.start)
    return web("Interfaccia web (script start)", {image: NODE_IMAGE, build,
      start: "HOST=0.0.0.0 PORT=3000 npm start", port: 3000}, evidence);
  if (server && scripts.start)
    return none("Servizio HTTP senza interfaccia grafica (solo API)", evidence,
      {image: NODE_IMAGE, build, start: "HOST=0.0.0.0 PORT=3000 npm start", port: 3000, enabled: false});
  if (html && !scripts.start)
    return web("Sito statico (index.html)", {image: NODE_IMAGE, build: "true",
      start: "npx --yes http-server@14.1.1 . -a 0.0.0.0 -p 8080", port: 8080}, ["index.html"]);
  return none(pkg.bin ? "Programma a riga di comando: nessuna interfaccia grafica"
    : "Libreria o progetto senza server web: nessuna interfaccia grafica", evidence);
}

/** Python project (requirements.txt or pyproject.toml). */
function detectPython(manifest, files, manifestPath) {
  const text = manifest.toLowerCase();
  const evidence = [manifestPath];
  const install = files.has("requirements.txt")
    ? "pip install --no-cache-dir -r requirements.txt" : "pip install --no-cache-dir .";
  const entry = ["app.py", "main.py", "wsgi.py", "server.py"].find(f => files.has(f));
  const module = entry ? entry.slice(0, -3) : "app";
  const templates = [...files].some(f => /(^|\/)(templates|static)\//u.test(f));
  if (/\bdjango\b/u.test(text) && files.has("manage.py"))
    return web("Applicazione Django", {image: PYTHON_IMAGE, build: install,
      start: "python manage.py runserver 0.0.0.0:8000", port: 8000}, evidence);
  if (/\bstreamlit\b/u.test(text) && entry)
    return web("Applicazione Streamlit", {image: PYTHON_IMAGE, build: install,
      start: `streamlit run ${entry} --server.address 0.0.0.0 --server.port 8000`, port: 8000}, evidence);
  if (/\bflask\b/u.test(text)) {
    const profile = {image: PYTHON_IMAGE, build: install,
      start: `python -m flask --app ${module} run --host 0.0.0.0 --port 8000`, port: 8000};
    return templates ? web("Applicazione Flask con pagine web", profile, evidence)
      : none("Servizio Flask senza pagine web (solo API)", evidence, {...profile, enabled: false});
  }
  if (/\bfastapi\b/u.test(text)) {
    const profile = {image: PYTHON_IMAGE, build: install,
      start: `python -m uvicorn ${module}:app --host 0.0.0.0 --port 8000`, port: 8000};
    return templates ? web("Applicazione FastAPI con pagine web", profile, evidence)
      : none("Servizio FastAPI senza pagine web (solo API)", evidence, {...profile, enabled: false});
  }
  return none("Progetto Python senza server web: nessuna interfaccia grafica", evidence);
}

/**
 * @param files   every path of the repository at main (strings)
 * @param read    async (path) => text | undefined   (small files only)
 */
export async function detectStaging({files, read}) {
  const paths = new Set(files);
  let reads = 0;
  const readText = async path => (++reads > MAX_READS ? undefined : await read(path));

  if (paths.has("package.json")) {
    const pkg = parseJson(await readText("package.json") ?? "");
    if (pkg && typeof pkg === "object") return detectNode(pkg, paths);
    return none("package.json non leggibile", ["package.json"]);
  }
  for (const manifest of ["requirements.txt", "pyproject.toml"]) {
    if (paths.has(manifest)) return detectPython(await readText(manifest) ?? "", paths, manifest);
  }
  if (paths.has("index.html"))
    return web("Sito statico (index.html)", {image: PYTHON_IMAGE, build: "true",
      start: "python -m http.server 8000 --bind 0.0.0.0", port: 8000}, ["index.html"]);
  if (paths.has("Dockerfile"))
    return none("Progetto con Dockerfile: configura a mano come avviarlo", ["Dockerfile"]);
  return none("Nessun progetto web riconosciuto: nessuna interfaccia grafica", []);
}
