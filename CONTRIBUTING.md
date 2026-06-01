# Contributing

Sunday is currently an actively evolving personal agent desktop shell. The goal
is to keep contributions easy to review, easy to verify, and safe to open
source later.

## Before You Start

- Open an issue for bugs, substantial refactors, or new capability proposals.
- Keep changes scoped to one concern when possible.
- Avoid introducing new dependencies unless the change clearly requires them.

## Local Setup

1. Copy `.env.example` to `.env.local`.
2. Install JavaScript dependencies:
   - `npm install`
   - `cd web-client && npm install`
   - `cd ../pi-sidecar && npm install`
3. Build the web client:
   - `cd web-client && npm run build`
4. Build the Qt host in a local build directory:
   - `cmake -S host-qt -B .build/host-qt`
   - `cmake --build .build/host-qt -j2`

If your binaries are not in the default location, set:

- `PERSONAL_AGENT_HOST_BUILD_DIR`
- or `PERSONAL_AGENT_HOST_BIN`

## Development Workflow

- Use feature branches.
- Prefer small pull requests with a clear verification story.
- Update docs when behavior or setup changes.
- Do not commit `.env.local`, local logs, build outputs, or personal machine paths.

## Verification Expectations

Run the lightest set of checks that proves your change:

- `npm run verify:repo`
- `cd web-client && npm run type-check`
- targeted `npm run verify:*` scripts relevant to your change

If you cannot run a verification step, call that out in the PR.

## Pull Request Checklist

- The change is scoped and described clearly.
- Local setup instructions still work.
- Tests or verification scripts were run and noted.
- New config, env vars, or security-sensitive behavior is documented.

## Security

If you discover a vulnerability, do not open a public issue first. Follow
`SECURITY.md`.
