---
name: publish
description: Bump the package version and publish the CLI privately. Also updates the readme-cli skill and README with the new version.
disable-model-invocation: true
argument-hint: [major|minor|patch]
---

Bump the version, update references, and publish the package privately.

## Steps

1. Read `package.json` to get the current version.
2. Determine the bump type from `$ARGUMENTS`. Default to `patch` if no argument is given.
   - `patch`: 0.0.3 → 0.0.4
   - `minor`: 0.1.3 → 0.2.0
   - `major`: 0.1.3 → 1.0.0
3. Update the `"version"` field in `package.json` with the new version.
4. Update the version number in `.claude/skills/readme-cli/SKILL.md` if it references a specific version.
5. Update the version number in `README.md` if it references a specific version.
6. Run `npm publish --access restricted` to publish privately.
7. Report the old and new version to the user.
