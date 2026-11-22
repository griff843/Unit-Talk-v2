# Mutations

## Evidence

Each file holds the mutation diff followed by the test run. Each mutation makes at least one test fail, and the code was restored after each one.

- `mutation-a-ignore-stated-line.txt`: always append the line, even when the selection states it. 1 failure.
- `mutation-b-drop-spread-sign.txt`: drop the `+` on positive spreads. 1 failure.
- `mutation-c-restore-at-marker.txt`: put the ` @ ` odds marker back. 1 failure.
- `mutation-d-underscore-run-line.txt`: stop matching `run_line`/`puck_line` keys. 1 failure.
