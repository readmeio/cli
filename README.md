# ReadMe CLI

A command-line tool for writing, previewing, and managing your [ReadMe](https://readme.com) docs from your terminal.

> **Currently in beta!** Things may change, break, or otherwise be a little rough around the edges. We'd love your feedback. Please [open an issue](https://github.com/readmeio/cli/issues) if you run into anything or have ideas for improvements.

## Commands

### Linting

Checks your docs for errors: things like invalid frontmatter, missing files, duplicate slugs, and more. Handy for catching issues before you push.

```bash
npx @readmeio/cli-beta lint [--fix] [--json]
```

Use `--fix` to automatically fix what it can, or `--json` for machine-readable output (great for CI).

### OpenAPI Sync

Syncs your `reference/` directory with your OpenAPI spec. It'll create, update, or remove pages based on your spec's operations.

```bash
npx @readmeio/cli-beta oas:sync
```

### Import

Imports content from an external folder and converts it into ReadMe's format using Claude. Great for migrating existing docs.

```bash
npx @readmeio/cli-beta import
```

### Versions

Lists all your doc versions and their branches.

```bash
npx @readmeio/cli-beta versions
```

### Dev Server

> **Very early beta!** This command is still a work in progress, and doesn't use our rendering engine yet.

Starts a local dev server so you can preview your docs as you write them. Watches for changes and refreshes automatically.

```bash
npx @readmeio/cli-beta dev
```

## Feedback

This is a beta! If something doesn't work right, or if you have suggestions, please [open an issue](https://github.com/readmeio/cli/issues). We're actively building this and want to hear from you.
