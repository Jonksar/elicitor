# Releasing

Releases run from `.github/workflows/release.yml` with [Changesets](https://github.com/changesets/changesets)
and npm trusted publishing: GitHub Actions proves its identity to npm with a short-lived OIDC
token, so no npm token is stored in the repository or its secrets, and npm attaches provenance to
every version.

## How a release happens

1. Pull requests that change a package include a changeset (`pnpm changeset`).
2. On every push to `main`, the release workflow runs `changesets/action`. While changesets are
   pending it opens or updates a pull request titled "chore: release packages" that runs
   `changeset version`: all five packages get the same new version (fixed group), changelogs are
   written and the changeset files are deleted.
3. Merging that pull request pushes to `main` again. With no changesets left, the action runs
   `pnpm release` (`pnpm build && changeset publish`). `changeset publish` calls `pnpm publish` for
   every package whose version is not on npm yet; pnpm rewrites `workspace:*` dependencies to the
   exact version, authenticates with the OIDC token and attaches provenance. The action then pushes
   git tags and creates GitHub releases.

The release pull request is created with the workflow's `GITHUB_TOKEN`, and GitHub does not run
other workflows for pull requests created that way, so CI does not run on it. After the merge, CI
and the publishing release run start on the same push, side by side; the publish does not wait for
CI. Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` on the release branch before
merging it.

The workflow needs: Node 24 (npm documents Node 22.14.0 or later for trusted publishing), pnpm from
the `packageManager` field (12.14.0, which implements trusted publishing in `pnpm publish` itself),
`id-token: write`, `contents: write` and `pull-requests: write`. There is no `NPM_TOKEN`, no
`NODE_AUTH_TOKEN` and no `registry-url`, and the release job uses no dependency cache.

## One-time setup (owner)

npm only lets you configure a trusted publisher on a package that **already exists** on the
registry ("The package you're configuring must already exist on the npm registry", from the
[`npm trust` docs](https://docs.npmjs.com/cli/v12/commands/npm-trust/)). npm has no "pending
publisher" for names that were never published. So each of the five names has to be published once
by hand before CI can publish it. The steps below publish a small placeholder version for that, so
that the real 0.1.0 is published by CI with provenance.

A new trusted publisher configuration expires if it has not completed a successful publish
**within 2 days** ([trusted publishers](https://docs.npmjs.com/trusted-publishers)). Do steps 4 to
6 in one sitting.

### 1. GitHub repository

1. Create the public repository `jonksar/elicitor` (provenance requires a public repository),
   empty, without pushing yet.
2. Settings → Actions → General: enable **Allow GitHub Actions to create and approve pull
   requests**. Without it the release workflow cannot open its pull request. (If you pushed first,
   re-run the failed release run after enabling it.)
3. Settings → Code security: enable **Private vulnerability reporting**, which the link in
   `SECURITY.md` needs.
4. Push `main`.

The first push runs the release workflow, which opens "chore: release packages" with all five
packages at `0.1.0`. **Do not merge it yet**: without trusted publishers its publish step fails.

If you protect `main` with a required CI check, note that CI never runs on the release pull request
(see above), so it can only be merged by an administrator bypassing the rule, or after you push a
commit to its branch yourself, which does trigger CI.

### 2. npm account and organisation

1. On npmjs.com, enable two-factor authentication on your account ("Authorization and writes").
   `npm trust` requires it.
2. Create the organisation `elicitor` (npmjs.com → Add Organization, free plan, public packages).
   This reserves the `@elicitor` scope. On 2026-11-25 the registry answered 404 for `elicitor` and
   all five `@elicitor/*` names and a scope search found no packages; whether the org name or a
   user named `elicitor` already exists cannot be seen without signing in, so the creation form is
   the real check.
3. Log in locally: `npm login` (npm 11.15.0 or later for `npm trust`; `npm --version`).

### 3. The unscoped `elicitor` name (optional)

To keep the unscoped name from being taken, publish a pointer package once. It is not part of the
workspace and is not published by CI.

```sh
mkdir -p /tmp/elicitor-name && cd /tmp/elicitor-name
cat > package.json <<'EOF'
{
  "name": "elicitor",
  "version": "0.0.1",
  "description": "Elicitor is published as @elicitor/react-ui, @elicitor/core and related packages.",
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/jonksar/elicitor.git" }
}
EOF
printf '# elicitor\n\nThis name is reserved. Install `@elicitor/react-ui` and `@elicitor/core`: https://github.com/jonksar/elicitor\n' > README.md
npm publish
```

npm rejects names it considers too similar to an existing package; if that happens the name cannot
be reserved and nothing else changes. npm's policy disallows squatting names without a purpose, so
keep the README pointing at the real packages.

### 4. Placeholder versions of the five packages

Each placeholder is version `0.0.1`, below the first real release, `0.1.0`. (A prerelease version
such as `0.0.0-placeholder.0` would need `--tag`, which npm refuses to leave out.) Run from any
directory:

```sh
for pkg in core anthropic capture react react-ui; do
  dir="$(mktemp -d)"
  cat > "$dir/package.json" <<EOF
{
  "name": "@elicitor/$pkg",
  "version": "0.0.1",
  "description": "Placeholder so trusted publishing can be configured. Use 0.1.0 or later.",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/jonksar/elicitor.git",
    "directory": "packages/$pkg"
  }
}
EOF
  (cd "$dir" && npm publish --access public)
done
```

With two-factor authentication on, npm asks you to confirm each publish (a browser prompt or a
one-time password). Each placeholder holds the `latest` tag until CI publishes 0.1.0 under
`latest`. `npm publish --dry-run` with npm 11.20 accepted this manifest.

### 5. Trusted publishers

One configuration per package, all pointing at this repository and `release.yml`. The workflow uses
no GitHub environment, so leave the environment empty. The workflow file name must match exactly.

```sh
for pkg in core anthropic capture react react-ui; do
  npm trust github "@elicitor/$pkg" --repo jonksar/elicitor --file release.yml --allow-publish --yes
  sleep 2
done
npm trust list @elicitor/core
```

The same can be done on npmjs.com: package → Settings → Trusted publishing → GitHub Actions, with
organisation or user `jonksar`, repository `elicitor`, workflow filename `release.yml`. npm does not
validate the configuration when it is saved; a mistake shows up only as a failed publish.

### 6. First release

1. Merge "chore: release packages". The release run publishes `@elicitor/*@0.1.0` through OIDC.
2. Check: `npm view @elicitor/react-ui@0.1.0 dependencies` shows `0.1.0` for the internal
   packages, and each package page on npmjs.com shows the provenance statement.
3. Deprecate the placeholders:

   ```sh
   for pkg in core anthropic capture react react-ui; do
     npm deprecate "@elicitor/$pkg@0.0.1" "Placeholder. Use 0.1.0 or later."
   done
   ```

4. For each package: Settings → Publishing access → **Require two-factor authentication and
   disallow tokens**. Trusted publishing keeps working; tokens can no longer publish.

If the run fails with an authentication error, compare the trusted publisher fields with the
repository and workflow file name (case-sensitive), fix them, and re-run the failed job. If more
than 2 days have passed since step 5, delete and recreate the configurations first.

## Later releases

Nothing to do beyond merging the release pull request. To add a sixth package, publish a
placeholder and configure its trusted publisher (steps 4 and 5 for that name) before the first
release that includes it, and add it to the fixed group if it does not match `@elicitor/*`.

## Checking a release locally

`pnpm changeset status` lists what the next release bumps. To see the result without touching your
checkout, run `pnpm changeset version` in a throwaway clone and inspect the `package.json` and
`CHANGELOG.md` changes. `pnpm pack` in a package directory shows the exact tarball, with
`workspace:*` already rewritten.
