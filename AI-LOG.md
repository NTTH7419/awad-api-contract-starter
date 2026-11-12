## 2026-11-12 - Implementing the versioned API

Tool: Codex desktop agent

Asked for: Implement `/v1` in `src/v1.js`, add the required legacy response headers in `src/app.js`, create a reversible migration for any new table, leave `CONTRACT.md` and `test/` untouched, and run `npm test`.

Kept: The agent's implementation of the `/v1` menu and order endpoints, RFC 9457 problem responses, validation, idempotency replay storage, cursor pagination, the `002_idempotency_keys` migration with a down migration, and the legacy `Deprecation`, `Sunset`, and successor-version `Link` headers.

Changed: I had the agent add database/server shutdown handling after the two-instance cleanup problem appeared. This releases SQLite handles and closes idle HTTP connections during shutdown; it is relevant to real deployment hygiene, not to the API contract's response semantics.

Rejected: I did not accept changing `CONTRACT.md` to make the implementation easier, and I did not ask the agent to weaken or edit a test assertion. The original task explicitly prohibited changes below `test/`.

## 2026-11-12 — Diagnosing Windows failures in the "two instances" contract test suite
Tool: Claude (claude.ai chat), plus the diagnosis from the coding agent that implemented the API, which I pasted in for review
Asked for: Explain why `test/contract.test.js` failed on Windows (first `null !== 0` from `migrate`, then `EPERM` in the `after` hook) and write an English explanation for NOTES.md.

Kept:
- The diagnosis of the first failure: `new URL('..', import.meta.url).pathname` gives a URL-style path (`/D:/...`) on Windows, so `spawnSync` with that `cwd` never started `migrate` (`status` null, `stderr` undefined). The `fileURLToPath` fix for `ROOT` (plus its import) is the only change made to the test file.
- The diagnosis of the `EPERM`: `p.kill()` only sends a signal, the `after` hook then calls `rmSync` immediately, and Windows keeps `app.db` (and `-wal` / `-shm`) locked until the child process has actually exited. Linux and macOS allow deleting open files, so it only shows up on Windows. This is a race in the test's cleanup, not a contract violation. I documented it in NOTES.md.
- The coding agent's statement that it reproduced the issue (delete right after `kill` gives `EPERM`; waiting for `exit` succeeds). I did not reproduce this myself.

Changed:
- Nothing in the code for the `EPERM`. The `after` hook is unchanged and I have not applied or run any fix for it.
- The first draft of the NOTES.md entry said "I did not modify the test file". That was wrong because of the `ROOT` change. It now says exactly one change was made (`ROOT` and its `node:url` import) and that the `after` hook was left alone.

Rejected:
- Applying any fix to the `after` hook. The test file says not to edit it, so I limited my change to the path bug. The suggested fix (wait for both children to exit, with a 3-second timeout, then `rmSync` with retries) is recorded in NOTES.md as "suggested, not applied" and has not been run.
- Claude's first suggested hook, which used a bare `await once(p, 'exit')` with no timeout. When I tried it, the test run hung until I pressed Ctrl+C, which is why the suggested version has a timeout.
- Claude's guesses that the hang came from `app.close()` or keep-alive connections in `helpers.js`. They were speculation and I did not verify them.
- Relying on server-side `SIGTERM` handling (closing the database and keep-alive connections) as the fix. It helps, but it cannot make the parent wait for the child to exit.
- `--test-force-exit`, because it hides the symptom and does not fix the cause.

## 2026-11-12 - Investigating the two-instance contract-run failure

Tool: Codex desktop agent

Asked for: Diagnose and fix the reported failures for cross-instance idempotency replay and cursors.

Kept: The diagnosis that completed idempotency replay and cursor state are database-backed, so they can be used from another instance. I also kept the portable `fileURLToPath(new URL(...))` change in `scripts/migrate.js`, because the old URL pathname was malformed as a Windows filesystem path.

Changed: The migration-script directory calculation was rewritten from `.pathname` to `fileURLToPath(...)` so `npm run migrate` can find `migrations/` on Windows.

Rejected: I rejected treating a cancelled test as proof that the API endpoint itself was incorrect. I also rejected a test-only workaround for process spawning; the contract implementation should not depend on altered test behaviour.

## 2026-11-12 - Investigating Windows cleanup errors

Tool: Codex desktop agent

Asked for: Fix the reported `EPERM` error while the two-instance test removes its temporary SQLite directory.

Kept: The evidence from a local reproduction: removing the directory immediately after signalling child processes can fail on Windows, while waiting for both child `exit` events releases the files successfully.

Changed: `src/app.js` now closes the supplied SQLite database when its HTTP server closes, and `src/server.js` closes idle connections on shutdown. These changes reduce the window in which a server holds the database files.

Rejected: I did not change the test cleanup to hide the race. A fully reliable cleanup requires the parent test harness to wait for each child process to exit before calling `rmSync`; changing that is outside the originally permitted source files.

## 2026-11-12 - Reviewing contract ambiguities

Tool: Codex desktop agent

Asked for: Identify sentences in `CONTRACT.md` that can be read two ways and state the chosen interpretation.

Kept: The documented choices for JSON-value equality, check ordering, non-object and empty JSON bodies, media-type handling, numeric path/query syntax, cursor/table binding, `nextCursor` lookahead, problem-detail wording, and legacy header scope.

Changed: I converted the agent's discussion into the structured ambiguity section in `NOTES.md`, including a proposed clarifying sentence for each point.

Rejected: I did not apply any proposed wording to `CONTRACT.md`. The contract says such changes must be a separate, justified commit, and the assignment rules forbid editing it.
