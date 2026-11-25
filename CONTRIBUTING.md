# Contributing

## Setup

1. Node 20 or later (CI uses 22, releases 24) and pnpm, through Corepack: `corepack enable`. The
   root `package.json` pins the pnpm version.
2. `pnpm install`
3. The browser tests of `@elicitor/capture`, `@elicitor/react` and `@elicitor/react-ui` run in
   Chromium through Playwright. Install it once:

   ```sh
   pnpm --filter @elicitor/capture exec playwright install chromium
   ```

   Playwright is a dependency of the packages, not of the root, so `pnpm exec playwright` works
   inside `packages/capture` (or with `--filter` as above). On Linux add `--with-deps` for the
   system libraries.

4. `pnpm dev` runs the demo in `examples/vite-react` (fake model, no API key).

## Scripts

| Command          | What it does                                                                 |
| ---------------- | ---------------------------------------------------------------------------- |
| `pnpm dev`       | The Vite demo.                                                               |
| `pnpm lint`      | Biome: lint and format check (TypeScript, CSS, JSON and Markdown).           |
| `pnpm format`    | Biome with `--write`.                                                        |
| `pnpm typecheck` | `tsc --noEmit` in every package.                                             |
| `pnpm test`      | Vitest in every package: unit tests in Node, `*.browser.test.*` in Chromium. |
| `pnpm build`     | tsdown builds each package's `dist/`.                                        |
| `pnpm size`      | size-limit on the built `react-ui` and `capture` bundles.                    |
| `pnpm changeset` | Adds a changeset.                                                            |

Before opening a pull request run
`pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm size`. CI runs the same, plus the
example build.

## Changesets and versioning

Every change that affects a published package needs a changeset: run `pnpm changeset`, pick the
packages and the bump, and write one or two sentences for the changelog. Docs-only and test-only
changes need none.

The five `@elicitor/*` packages are in one **fixed** group (`.changeset/config.json`): they always
share one version number, and a release bumps all of them. While the version is 0.x, a breaking
change is a `minor` bump and everything else is `patch`.

Releases are automated; see [docs/releasing.md](docs/releasing.md). Do not change `version` fields
by hand.

## Code

- TypeScript with strict settings (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `isolatedDeclarations`). Every exported function needs an explicit return type.
- `@elicitor/core` has no runtime dependencies. Keep it that way.
- New public API needs a test and a line in the package README.
- User-facing texts go into all four bundles in `packages/react-ui/src/i18n.ts`; the bundle test
  checks the keys match.

## Test data

Fixtures, snapshots, screenshots and examples must not contain real customer data, real personal
data or production URLs. Use invented names, amounts and ids, and `example.com` or `.example`
hosts.
