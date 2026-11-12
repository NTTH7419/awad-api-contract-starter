**Two things I expect the agent to get wrong**

1. The agent will likely validate the body before looking up the `Idempotency-Key` (or check the key and then insert it non-atomically), even though §4.2 fixes the order as key header, then JSON, then key lookup (replay / reused / in-flight), then validation, then unknown items. This is counterintuitive (“validate first” feels natural), and `409 idempotency-key-in-flight` needs an atomic way to claim the key, while the spec also says to store the key in the same transaction as the order and only on `201`, so agents often skip the in-flight case or introduce a race.
2. The agent will likely return a non-null `nextCursor` whenever a page is full (`limit` items), so a client can receive a cursor that leads to an empty page, violating “`nextCursor` is `null` if and only if there are no more orders”. The simplest implementation is `LIMIT limit`, while the correct one (fetch `limit + 1` rows, trim the extra, and set the cursor only if the extra row existed) requires careful reading of one sentence in the middle of the cursor section.

**Known test-environment issue: file path bug (Windows)**

`test/contract.test.js` computes the project root with:

```js
const ROOT = new URL('..', import.meta.url).pathname;
```

On Windows, `.pathname` returns a URL-style path such as `/D:/FIT@HCMUS/.../awad-api-contract-starter/` (leading slash, forward slashes), which is not a valid Windows directory. Passing it as `cwd` to `spawnSync` / `spawn` makes the child process fail to start, so `migrate` never runs: `m.status` is `null` and `m.stderr` is `undefined`, producing `npm run migrate failed: undefined` and `null !== 0`. The two tests that follow (§4.2 and §4.4, the “two instances” tests) are then cancelled because the suite’s `before` hook failed. The failure comes from the test file’s path handling, not from the API implementation. The fix is `fileURLToPath(new URL('..', import.meta.url))`, and running the tests on Linux/macOS or WSL avoids it.
