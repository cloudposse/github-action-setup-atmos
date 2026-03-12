# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GitHub Action that installs the [Atmos CLI](https://github.com/cloudposse/atmos) into a runner's PATH. It resolves versions from GitHub Releases, downloads the binary, optionally installs a Node.js wrapper script that captures stdout/stderr/exitcode as action outputs, and caches the result via `@actions/tool-cache`.

## Commands

```bash
yarn --frozen-lockfile          # Install dependencies (use --frozen-lockfile, not yarn install)
yarn test                       # Run all unit tests (Jest)
yarn lint                       # Lint and auto-fix
yarn lint:check                 # Lint without fixing
yarn format                     # Format with Prettier
yarn format:check               # Check formatting
yarn clean && yarn build && yarn build:wrapper  # Full production build (ncc bundle)
```

Run a single test file: `yarn test -- src/__tests__/setup-atmos.test.ts`

The CI pipeline (`.github/workflows/main.yml`) runs: lint → format → test → build → integration test (uses `./` action reference). CI auto-commits build artifacts back to the PR branch.

## Architecture

**Two entry points, one action:**

- `src/setup-atmos.ts` → `src/main.ts` → `src/installer.ts` — the action's `main` entry (`dist/index.js`). Resolves the requested atmos version from GitHub Releases via Octokit, downloads the binary, caches it, and adds it to PATH.
- `src/wrapper.ts` — built separately to `dist/wrapper/index.js`. A Node.js script that wraps the real `atmos-bin` binary, capturing stdout/stderr/exitcode as GitHub Action outputs. Installed as `atmos` in the tool path (the real binary is renamed to `atmos-bin`).

**Supporting modules:**

- `src/system.ts` — OS/arch normalization (maps Node.js values to atmos release naming: `x64`→`amd64`, `win32`→`windows`, etc.)
- `src/atmos-bin.ts` — binary name helpers (handles wrapper vs direct naming, Windows `.exe` suffix)
- `src/interfaces.ts` — TypeScript interfaces for version resolution
- `src/output-listener.ts` — simple stream listener used by the wrapper

**Build:** Uses `@vercel/ncc` to bundle TypeScript into single-file JS outputs. The action runs on `node24`.

## Key Conventions

- Package manager is **Yarn 1** (classic). Do not use npm or Yarn 2+.
- ESLint enforces alphabetical import ordering with blank lines between groups (`import/order` rule with `newlines-between: always`).
- Destructure keys must be sorted (`sort-destructure-keys` plugin).
- Tests use `nock` for HTTP mocking (see `jest-nock` and fixtures in `src/__fixtures__/`).
- The `dist/` directory is committed — after code changes, always rebuild before committing.
