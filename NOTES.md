## Two things I expect the agent to get wrong**

1. The agent will likely validate the body before looking up the `Idempotency-Key` (or check the key and then insert it non-atomically), even though §4.2 fixes the order as key header, then JSON, then key lookup (replay / reused / in-flight), then validation, then unknown items. This is counterintuitive (“validate first” feels natural), and `409 idempotency-key-in-flight` needs an atomic way to claim the key, while the spec also says to store the key in the same transaction as the order and only on `201`, so agents often skip the in-flight case or introduce a race.
2. The agent will likely return a non-null `nextCursor` whenever a page is full (`limit` items), so a client can receive a cursor that leads to an empty page, violating “`nextCursor` is `null` if and only if there are no more orders”. The simplest implementation is `LIMIT limit`, while the correct one (fetch `limit + 1` rows, trim the extra, and set the cursor only if the extra row existed) requires careful reading of one sentence in the middle of the cursor section.

## Known test-environment issues on native Windows

Two problems in `test/contract.test.js` show up only on native Windows. Neither
is a defect in CONTRACT.md or in the `/v1` implementation. Both affect only the
suite "§4 two instances, one database (as in session 4)", which contains the
§4.2 cross-instance replay test and the §4.4 cross-instance cursor test.

### 1. File path bug: `ROOT` (fixed)

The test computed the project root with:

    const ROOT = new URL('..', import.meta.url).pathname;

On Windows, `.pathname` returns a URL-style path such as
`/D:/FIT@HCMUS/.../awad-api-contract-starter/` (leading slash, forward
slashes). That is not a valid Windows directory, so passing it as `cwd` to
`spawnSync` / `spawn` makes the child process fail to start. `migrate` never
ran: `m.status` was `null` and `m.stderr` was `undefined`, which produced
`npm run migrate failed: undefined` and `null !== 0`. The §4.2 and §4.4 tests
were then cancelled with "test did not finish before its parent and was
cancelled", because the suite's `before` hook had failed.

Fix applied: `ROOT` is now

    const ROOT = fileURLToPath(new URL('..', import.meta.url));

with the matching import `import { fileURLToPath } from 'node:url';`.

### 2. EPERM during cleanup in the `after` hook (not fixed)

After the path fix, the suite starts and the tests run, but the `after` hook
can fail with:

    EPERM, Permission denied: ...\Temp\contract-XXXXXX

This is a race condition in the test's cleanup step. The suite starts two real
`node src/server.js` child processes on one SQLite database file inside a temp
directory. The hook calls `p.kill()` on each child and then immediately calls
`rmSync(dir, { recursive: true, force: true })`. `kill()` only sends a signal;
it does not wait for the process to terminate. On Windows a file handle is
released only when the process has actually exited, so while either instance
still holds `app.db` (and its `-wal` / `-shm` files), the delete is refused
with `EPERM`. On Linux and macOS deleting an open file is allowed, so the
problem does not appear there.

Server-side mitigations (closing the DatabaseSync handle on shutdown, closing
keep-alive connections on `SIGTERM`) are worthwhile but cannot guarantee that
the children have exited before the parent calls `rmSync`. Only the test
harness can wait for that. Reproduced: deleting the directory right after
`child.kill('SIGTERM')` fails with `EPERM`; waiting for the `exit` event of both
children before deleting succeeds.

Suggested fix (not applied): wait for both children to exit, with a timeout so
the hook can never hang, then remove the directory with retries:

    after(async () => {
      await Promise.all(procs.map(async (p) => {
        if (p.exitCode !== null || p.signalCode !== null) return;
        const exited = once(p, 'exit');
        p.kill();
        await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
      }));
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });

(The timeout matters: an earlier attempt that did a bare `await once(p, 'exit')`
hung the test run and needed Ctrl+C.)

## Scope of changes to `test/contract.test.js`

The file says not to edit it. The only change made is the `ROOT` constant and
its `node:url` import, because the original is not a valid directory path on
Windows. No test logic, assertion or cleanup code was changed. The `after`-hook
race in section 2 is left as is.

## How to read a failure here

A failure of the "two instances" suite's `after` hook on Windows (`EPERM`) is a
harness portability issue and is not evidence that the API violates
CONTRACT.md. The §4.2 and §4.4 results themselves should be read from their own
pass/fail lines, and, if in doubt, verified on Linux, macOS or WSL.
