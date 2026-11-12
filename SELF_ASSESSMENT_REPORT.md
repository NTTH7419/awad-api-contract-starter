# Self-assessment - IA#3

Submitted by: 23127510 - Phùng Ngọc Tuấn

Total I claim: 86 / 100

| Criterion                                 | Max | I claim | Evidence                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | --: | ------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The contract tests pass                |  30 |      29 | `contract-run-final.txt` records all 29 API subtests passing, but the command still fails in the two-instance suite's Windows cleanup with `EPERM`.                                                                                                                                                                                     |
| 2. The rules were kept                    |  10 |       9 | Commit `d2ff4b3` modifies `test/contract.test.js`, but it only changes Windows path handling. I will discuss this bug with the lecturer.                                                                                                                                                                                                |
| 3. Predictions, made before the agent ran |  10 |       6 | Commit `836e360` adds `NOTES.md` before the first `src/` implementation commit `82d9a25`. It gives two predictions with reasons: the idempotency check order in CONTRACT.md section 4.2 and `nextCursor` behaviour in section 4.4. The required explicit outcome line for each prediction is missing.                             |
| 4. The first run, read line by line       |  20 |      17 | `contract-run-1.txt`, committed in `82d9a25`, records the first contract run. `NOTES.md` explains the cancelled two-instance tests and the subsequent native-Windows process/path issues, but it does not provide the requested per-failing-test contract sentence, implementation behaviour, and proposed wording for every failure. |
| 5. Sentences that could be read two ways  |  20 |      15 | `NOTES.md`, section "Ambiguities in CONTRACT.md: decisions and proposed wording", documents eight decisions with section references, two readings, the chosen interpretation, and proposed contract text. The report does not establish that one ambiguity was independently found by the student rather than supplied by the agent.      |
| 6. AI-LOG.md                              |  10 |      10 |                                                                                                                                                                                                                                                                                                                                             |

## What I did not manage

I did not keep `test/contract.test.js` unchanged. The Windows path change in
commit `d2ff4b3` was intended to make the two-instance setup start, but the
rubric explicitly disallows any modification below `test/`; but I will discuss this bug with the lecturer, since it also happened in the previous PA. I did not add final
outcome lines for the two predictions. Finally, `contract-run-final.txt` is
not a clean successful command on native Windows: its 29 API subtests pass,
but the test suite's child-process cleanup raises `EPERM` when it immediately
deletes the shared SQLite temporary directory.

## What I would do differently

I would leave the supplied tests untouched, record the Windows harness issue
in `NOTES.md`, and run the required final command in the grading target
environment instead. Before asking the agent to change source files, I would
commit two predictions, then explicitly add an outcome line for each after the
first run.
