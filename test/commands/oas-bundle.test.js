import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bundleOas, writeBundle } from '../../src/commands/oas-bundle.js';
import { makeRepo, rmRepo } from '../helpers.js';

const ROOT_SPEC = `openapi: 3.0.0
info: { title: Pets, version: '1.0' }
paths:
  /pets:
    $ref: './partials/pets.yaml'
components:
  schemas:
    Pet:
      $ref: './partials/pet.json'
`;

const PETS_PARTIAL = `get:
  operationId: listPets
  responses:
    '200':
      description: ok
      content:
        application/json:
          schema:
            type: array
            items:
              $ref: '../openapi.yaml#/components/schemas/Pet'
`;

const PET_PARTIAL = JSON.stringify({ type: 'object', properties: { name: { type: 'string' } } });

const MULTI_FILE = {
  'specs/openapi.yaml': ROOT_SPEC,
  'specs/partials/pets.yaml': PETS_PARTIAL,
  'specs/partials/pet.json': PET_PARTIAL,
};

function collectRefs(obj, out = []) {
  if (obj && typeof obj === 'object') {
    if (typeof obj.$ref === 'string') out.push(obj.$ref);
    for (const v of Object.values(obj)) collectRefs(v, out);
  }
  return out;
}

test('bundles external YAML and JSON partials into one document with only internal refs', async () => {
  const root = makeRepo(MULTI_FILE);
  try {
    const spec = await bundleOas({ file: 'specs/openapi.yaml', cwd: root });

    expect(spec.paths['/pets'].get.operationId).toBe('listPets');
    expect(spec.components.schemas.Pet).toStrictEqual(JSON.parse(PET_PARTIAL));

    const refs = collectRefs(spec);
    expect(refs.every((r) => r.startsWith('#/'))).toBe(true, `expected only internal refs, got ${refs.join(', ')}`);
    expect(refs).toContain('#/components/schemas/Pet', 'cross-file ref should be rewritten to an internal pointer');
  } finally {
    rmRepo(root);
  }
});

test('resolves relative partials against the spec file, not the working directory', async () => {
  const root = makeRepo(MULTI_FILE);
  try {
    // cwd is the repo root; the spec lives in specs/ and its refs are relative to specs/.
    const spec = await bundleOas({ file: 'specs/openapi.yaml', cwd: root });
    expect(spec.paths['/pets'].get.operationId).toBe('listPets');
  } finally {
    rmRepo(root);
  }
});

test('writeBundle writes JSON by default and creates parent directories', async () => {
  const root = makeRepo(MULTI_FILE);
  try {
    const { outPath } = await writeBundle({ file: 'specs/openapi.yaml', out: 'reference/api.json', cwd: root });
    expect(outPath).toBe(path.join(root, 'reference/api.json'));

    const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    expect(written.info.title).toBe('Pets');
    expect(collectRefs(written).some((r) => !r.startsWith('#/'))).toBe(false);
  } finally {
    rmRepo(root);
  }
});

test('writeBundle serializes as YAML when the output path ends in .yaml', async () => {
  const root = makeRepo(MULTI_FILE);
  try {
    const { outPath } = await writeBundle({ file: 'specs/openapi.yaml', out: 'reference/api.yaml', cwd: root });

    const raw = fs.readFileSync(outPath, 'utf-8');
    expect(raw.startsWith('openapi: 3.0.0')).toBe(true, `expected YAML output, got:\n${raw.slice(0, 80)}`);
    expect(raw.includes("$ref: '#/components/schemas/Pet'")).toBe(true);
  } finally {
    rmRepo(root);
  }
});

test('rejects with a clear error when a referenced partial is missing', async () => {
  const root = makeRepo({
    'specs/openapi.yaml': ROOT_SPEC,
    'specs/partials/pets.yaml': PETS_PARTIAL,
    // partials/pet.json intentionally omitted
  });
  try {
    await expect(
      () => bundleOas({ file: 'specs/openapi.yaml', cwd: root })).rejects.toThrow(
      /pet\.json/
    );
  } finally {
    rmRepo(root);
  }
});

test('rejects when the spec file does not exist', async () => {
  const root = makeRepo({});
  try {
    await expect(
      () => bundleOas({ file: 'nope.yaml', cwd: root })).rejects.toThrow(
      /nope\.yaml/
    );
  } finally {
    rmRepo(root);
  }
});
