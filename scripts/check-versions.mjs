import { readFileSync } from "node:fs";

const manifests = [
  "package.json",
  "apps/web/package.json",
  "packages/schema/package.json",
  "packages/scene/package.json",
];

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const versions = manifests.map((path) => [path, JSON.parse(read(path)).version]);
const services = "services/pyproject.toml";
const project = read(services)
  .split(/(?=^[ \t]*\[[^\r\n]+\])/m)
  .find((section) => /^[ \t]*\[project\][ \t]*(?:#.*)?$/m.test(section));
versions.push([services, project?.match(/^[ \t]*version[ \t]*=[ \t]*(["'])([^"'\r\n]+)\1[ \t]*(?:#.*)?$/m)?.[2]]);

const version = versions[0][1];
const tag = process.argv[2];

if (versions.some(([, value]) => typeof value !== "string" || !value.trim() || value !== version)) {
  console.error("All manifests must have the same version:");
  for (const [path, value] of versions) console.error(`  ${path}: ${value ?? "(missing)"}`);
  process.exitCode = 1;
} else if (tag !== undefined && tag !== `v${version}`) {
  console.error(`Tag ${JSON.stringify(tag)} does not match package version v${version}.`);
  process.exitCode = 1;
} else {
  console.log(`All package versions match: ${version}`);
}
