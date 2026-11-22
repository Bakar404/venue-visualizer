import { readFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/release-notes.mjs <version>");
  process.exit(1);
}

const lines = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").split(/\r?\n/);
const start = lines.findIndex((line) => /^##[ \t]+\[([^\]]+)\](?:[ \t]+-.*)?[ \t]*$/.exec(line)?.[1] === version);
if (start === -1) {
  console.error(`No changelog section found for ${version}.`);
  process.exit(1);
}

const end = lines.findIndex((line, index) => index > start && /^(?:##[ \t]+|\[[^\]]+\]:)/.test(line));
console.log(lines.slice(start, end === -1 ? lines.length : end).join("\n").trimEnd());
