/**
 * Create or update a local Engineer console user (password typed hidden).
 *
 *   node poc/engineer-console/scripts/create-user.mjs engineer
 *
 * Writes poc/infra/runtime/console/users.json (gitignored, mode 0600) with a
 * scrypt hash only. The password itself is never written anywhere.
 */
import {join} from "node:path";
import {hashPassword, readUserFile, validateUsername, writeUserFile} from "../src/auth.mjs";
import {CONSOLE_DIR} from "../src/env.mjs";

function askHidden(question) {
  return new Promise((resolvePromise, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(Error("Run this command in an interactive terminal"));
    process.stdout.write(question);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    let value = "";
    const onData = (char) => {
      if (char === "\r" || char === "\n") {
        stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData);
        process.stdout.write("\n"); resolvePromise(value);
      } else if (char === "\u0003") {
        stdin.setRawMode(false); process.stdout.write("\n"); process.exit(130);
      } else if (char === "\u007f" || char === "\b") {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    stdin.on("data", onData);
  });
}

const username = validateUsername(process.argv[2] ?? "engineer");
const first = await askHidden(`Password per "${username}" (min 8 caratteri): `);
const second = await askHidden("Ripeti la password: ");
if (first !== second) {
  process.stderr.write("Le password non coincidono.\n");
  process.exit(1);
}
const path = join(CONSOLE_DIR, "users.json");
const users = readUserFile(path);
users[username] = {...hashPassword(first), created_at: new Date().toISOString()};
writeUserFile(path, users);
process.stdout.write(`Utente "${username}" salvato in ${path}\n`);
