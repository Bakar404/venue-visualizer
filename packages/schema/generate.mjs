// Generates index.ts from the JSON Schemas and openapi.ts from openapi.json (exported by the API). Run: pnpm --filter @vv/schema generate
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";
import openapiTS, { astToString } from "openapi-typescript";

const here = dirname(fileURLToPath(import.meta.url));
const files = ["design-spec.schema.json", "venue.schema.json", "venue-research.schema.json"];

const options = {
  bannerComment: "",
  additionalProperties: false,
  unreachableDefinitions: true,
  ignoreMinAndMaxItems: true,
  strictIndexSignatures: true,
  format: true,
  style: { singleQuote: false, semi: true, printWidth: 100 },
};

const parts = [
  "/* eslint-disable */",
  "/**",
  " * GENERATED FILE. Do not edit by hand.",
  " * Source: packages/schema/*.schema.json. Regenerate with `pnpm --filter @vv/schema generate`.",
  " */",
  "",
];

for (const file of files) {
  const schema = JSON.parse(await readFile(join(here, file), "utf8"));
  let ts = await compile(schema, schema.title ?? file, { ...options, cwd: here });
  // The venue schema is only a container for $defs; drop its empty wrapper type.
  ts = ts.replace(/export interface VenueSchemas \{[^}]*\}\n*/s, "");
  parts.push(`// ---- ${file} ----`, ts.trim(), "");
}

await writeFile(join(here, "index.ts"), parts.join("\n"));
console.log("wrote packages/schema/index.ts");

const api = astToString(await openapiTS(JSON.parse(await readFile(join(here, "openapi.json"), "utf8"))));
await writeFile(
  join(here, "openapi.ts"),
  [
    "/* eslint-disable */",
    "/**",
    " * GENERATED FILE. Do not edit by hand.",
    " * Source: packages/schema/openapi.json (`cd services && uv run python -m api.export_openapi`).",
    " * Regenerate with `pnpm --filter @vv/schema generate`.",
    " */",
    "",
    api,
  ].join("\n"),
);
console.log("wrote packages/schema/openapi.ts");
