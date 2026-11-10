#!/usr/bin/env node

// ncc turns json-schema-ref-parser's variable dynamic import() into an empty
// async context. That context is the only way the Action reaches
// node:dns/promises and undici, which the HTTP $ref safety checks need.
// src/gha.js registers the real modules; this rewrites the empty context to
// return them instead of throwing MODULE_NOT_FOUND.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ncc = path.join(root, 'node_modules', '.bin', 'ncc');

const build = spawnSync(ncc, ['build', 'src/gha.js', '-o', 'dist-gha', '--external', '@readme/markdown'], {
  cwd: root,
  stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);

const bundlePath = path.join(root, 'dist-gha', 'index.js');
const source = fs.readFileSync(bundlePath, 'utf8');
const needle =
  /function webpackEmptyAsyncContext\(req\) \{\s*\/\/ Here Promise\.resolve\(\)\.then\(\) is used instead of new Promise\(\) to prevent\s*\/\/ uncaught exception popping up in devtools\s*return Promise\.resolve\(\)\.then\(\(\) => \{\s*var e = new Error\("Cannot find module '" \+ req \+ "'"\);\s*e\.code = 'MODULE_NOT_FOUND';\s*throw e;\s*\}\);\s*\}/;

if (!needle.test(source)) {
  console.error('build:gha: ncc did not emit the expected empty async context. Update the patch in bin/build-gha.js.');
  process.exit(1);
}

const patched = source.replace(
  needle,
  `function webpackEmptyAsyncContext(req) {
	return Promise.resolve().then(() => {
		const known = globalThis.__readmeGhaDynamicImport;
		if (known && Object.prototype.hasOwnProperty.call(known, req)) return known[req];
		var e = new Error("Cannot find module '" + req + "'");
		e.code = 'MODULE_NOT_FOUND';
		throw e;
	});
}`,
);

fs.writeFileSync(bundlePath, patched);
