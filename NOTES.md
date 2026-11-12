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


## Ambiguities in CONTRACT.md: decisions and proposed wording

These are the sentences of CONTRACT.md that can be read two ways, what the
implementation chose, and the sentence I would add to the contract. Per the
contract's own rule, any change to CONTRACT.md goes in a separate commit that
says why. None has been applied.

### 1. "The same body" (§4.2, Idempotency)

- Reading A: byte-for-byte equal. Reading B: equal as parsed JSON.
- Decision: B, as the contract says "equal as JSON values". Key order and
  whitespace are ignored. Array order is significant. Numeric spellings that
  parse to the same value (`1` and `1.0`) count as the same.
- Proposed sentence: "Object members are compared without regard to order,
  array elements in order, and numbers by value, so `1` and `1.0` are the same."

### 2. Order of checks and empty or non-object bodies (§4.2, steps 1 to 4)

- Ambiguity: whether the idempotency lookup (step 3) comes before field
  validation (step 4), and how an empty body or a valid non-object body is
  classified.
- Decision: key header, then JSON parse, then idempotency lookup, then field
  validation, then menu item existence. An empty body is `invalid-json`. A
  valid JSON scalar or array is `validation` with pointer `""`.
- Proposed sentence: "A request with an empty body is `invalid-json`."

### 3. Content-Type (§4.2)

- Ambiguity: the contract says requests are JSON and the example shows
  `Content-Type: application/json`, but it defines no problem type for a wrong
  or missing media type.
- Decision: do not reject on media type alone. Parsing and validation decide
  the response.
- Proposed sentence: "The server does not inspect the request `Content-Type`;
  a body that is not valid JSON is `invalid-json`."

### 4. What "integer" means in paths and query strings (§2, §4.1, §4.3, §4.4)

- Ambiguity: whether `007`, `+7`, `7.0`, ` 7` or `0` are integers.
- Decision: only canonical positive base-10 digits (no sign, no decimal point,
  no whitespace, no leading zero, not zero). Anything else in a path is
  `not-found`. In a query parameter it is `validation` with `parameter` set.
- Proposed sentence: "An id in a path or a number in a query string is written
  as base-10 digits with no sign, no leading zero and no decimal point."

### 5. What a cursor means and its relation to `tableId` (§4.4)

- Ambiguity: the contract says "pages do not move under the client" and "use a
  cursor with the same `tableId` it came from", but does not say what happens
  if the filter differs.
- Decision: a cursor means "orders with an id strictly lower than this one".
  It also encodes the `tableId` filter (`null` for all tables). New orders get
  higher ids, so they cannot shift later pages. A cursor sent with a different
  `tableId` is `400 validation` with `parameter`: `cursor`.
- Proposed sentence: "A cursor sent with a different `tableId` than it was
  issued for is `400 validation` (`parameter`: `cursor`)."

### 6. When `nextCursor` is `null` (§4.4)

- Ambiguity: "null if and only if there are no more orders after this page"
  does not say how to know that without a lookahead.
- Decision: fetch `limit + 1` rows and trim the extra. `nextCursor` points at
  the last displayed order only if the extra row existed, so a full last page
  returns `null`.
- Proposed sentence: "A page that ends exactly at the last order has
  `nextCursor: null`."

### 7. Wording of `detail` (§2)

- Ambiguity: the contract limits what `detail` may not contain, but not its text.
- Decision: short, occurrence-specific sentences that leak nothing (no stack
  trace, SQL, table name or file path). For `500` the sentence is fixed and
  generic.
- Proposed sentence: "Clients must not parse `detail`; its wording may change
  without a new version."

### 8. Scope of the legacy headers (§5)

- Ambiguity: "every legacy response, errors included" does not say whether a
  404 for an unknown legacy path counts.
- Decision: `Deprecation` and `Sunset` are on every response produced by the
  legacy router, errors included. `Link: rel="successor-version"` is only on a
  successful `GET /menu/{id}`.
- Proposed sentence: "A request to a legacy path that matches no legacy
  endpoint is handled by the `/v1` rules if it starts with `/v1`, otherwise it
  carries the legacy headers."

## Known limitation: `409 idempotency-key-in-flight` across instances

The requirement itself is unambiguous. The current implementation tracks
in-flight keys in a process-local set. Completed replays work across instances
because the key, body fingerprint and response are stored in the database in
the same transaction as the order. But two truly simultaneous requests with the
same key landing on two different processes are not guaranteed to produce
`409` for the second one, because neither process can see the other's set.

Fully guaranteeing it requires a durable reservation (a lease row inserted
atomically with a unique key, with an expiry so a crashed instance does not
block the key forever). This is not implemented. The existing contract tests do
not exercise this case across instances.

Proposed sentence for the contract: "In-flight detection must hold across
every instance that shares the database, not only within one process."