# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

containerify builds OCI/Docker container images for node.js apps **without a Docker daemon** — it pulls a base image directly from a registry over HTTPS, adds layers for the application, and pushes the result to a registry (or exports to a tar / local Docker). This makes it usable inside containers on Kubernetes/OpenShift where no Docker socket is available. It's a single-binary CLI published to npm (`lib/cli.js`).

## Commands

- `npm run build` — compile TypeScript to `lib/` (runs `prebuild` first, which generates `src/version.ts` from `package.json`). The CLI runs from `lib/`, not `src/`, so **you must build before running integration tests**.
- `npm run check` — lint (`eslint --fix`) + `tsc --noEmit`. This is what CI gates on.
- `npm run lint` / `npm run typecheck` — run individually.
- `npm run watch` / `npm run dev` — `tsc --watch`.
- `npm run integrationTest` — runs `tests/integration/test.sh`. No Docker registry needed; builds to tar files and diffs configs/manifests. This is the main test in CI.
- `npm run registryTest` — `tests/localtest/test.sh` + `test-insecure.sh`. **Requires Docker** (spins up a local `registry:2` with TLS + htpasswd auth).
- `npm run allTests` — both of the above.

There is no unit-test framework. "Tests" are bash scripts that exercise the built CLI end-to-end and assert on output (digests, config/manifest equality via `cmp`/`jq`). To run a single scenario, invoke `lib/cli.js` directly the way the scripts do (see `tests/integration/test.sh`), or run one script directly: `cd tests/integration && ./test.sh`.

`tests/external-registries/` holds manual scripts for AWS ECR / GitHub ghcr that need real credentials — not run in CI.

## Architecture

The pipeline lives in [src/cli.ts](src/cli.ts) `run()` and flows in one direction:

1. **`cli.ts`** — all option parsing (commander), config-file merging, and validation. Options can come from CLI flags, a `containerify.json` config file (`--file`, auto-detected in `--folder`), or both (CLI overrides file). `exitWithErrorIf` enforces mutually-exclusive flags and required fields. Everything downstream receives a fully-resolved `Options` object. The `nonDefaults` field tracks which of user/workdir/entrypoint were *explicitly* set, which matters for `--customContent` (see below).
2. **`registry.ts`** `createRegistry(...).download()` — pulls the base image manifest/config/layers into a temp `from/` dir. Handles Docker Hub token auth, GitLab tokens, multi-arch index → platform selection (`pickManifest`), and a `--layerCacheFolder` cache.
3. **`appLayerCreator.ts`** `addLayers()` — the core logic. Copies base layers into `to/`, then appends new layers and rewrites config + manifest. Returns the final manifest descriptor (digest/size).
4. **Exporters** — `registry.ts` `.upload()` (push, with optional cross-mount), `tarExporter.ts` (`--toTar`), `dockerExporter.ts` (`--toDocker`, shells out to the `docker` CLI).

### Layering model (appLayerCreator.ts)

Normal node app builds add, in order: empty config layers (WORKDIR, ENTRYPOINT, USER, ENV, LABELS) then two data layers — **dependencies** (`package.json`, `package-lock.json`, `node_modules`) and **app** (everything else). Splitting deps from app code keeps the dependency layer cacheable across builds. The `ignore` list (`.git`, `.DS_Store`, etc.) is filtered out.

`--customContent` switches to a different path: it skips the node deps/app layers entirely and adds only the specified content, and it only sets WORKDIR/ENTRYPOINT/USER if they were *explicitly* provided (via `nonDefaults`) — so you can drop built assets into e.g. an nginx base without clobbering its runtime config. `--extraContent` adds extra layers on top of either path.

### Reproducible builds

A central feature: identical inputs should produce identical image digests. `--setTimeStamp` forces one timestamp on all entries; `--preserveTimeStamp` keeps original file mtimes; default is epoch (1970) in tars. These two flags are mutually exclusive. `--layerOwner gid:uid` rewrites uid/gid via tar's `onWriteEntry`. The integration test's whole point is asserting that two builds with the same args yield byte-identical config.json/manifest.json (and different ones when inputs differ).

### HTTP layer

`httpRequest.ts` wraps node's `https` with redirect-following, auth header building, and JSON download helpers. `registry.ts` is built entirely on it — there is no third-party HTTP client. `InsecureRegistrySupport` (enum) threads `--allowInsecureRegistries` through for self-signed certs. Type contracts for registry/manifest/config shapes live in [src/types.ts](src/types.ts).

## Conventions

- Tabs for indentation; formatting via prettier (`.prettierrc.json`) + `eslint-config-prettier`. Run `npm run check` before committing.
- `src/version.ts` is generated — never edit it by hand.
- Keep the README's `--help` option list and `cli.ts`'s commander definitions in sync when adding flags; also update `CHANGELOG.md`.
