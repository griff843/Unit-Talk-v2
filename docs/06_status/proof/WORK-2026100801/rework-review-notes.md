# Parent engineering review — bounded rework required

Continue WORK-2026100801 under the same captured task contract, scope and ratified authority. This is engineering rework, not a new product or PM policy decision. Do not expand scope or modify Discord, settlement or canonical carry-forward semantics. Do not recursively invoke ops:codex-exec. Preserve the genuine first epoch and its actual results; genuinely complete every phase of the new rework epoch.

## 1. Measured required-check freshness defect

/tmp/work0801-freshness-repro.mts executes the real pre-merge authorization with fake dependencies and no network. Its recorded JSON shows required checks become pending during collector execution at the unchanged head, but checkReads=1 and authorized=true. The pre-collector green snapshot remains authoritative. Repair this by re-evaluating the live required contexts/check evidence after collection and before authorization, using the normal exact-identity/latest-wins matcher. Refuse missing, newer pending/failing or unreadable results; preserve an auditable current check table. Keep the final HEAD recheck near the decision and preserve label/governance/PM withdrawal freshness so collection cannot lengthen an authorization window unchecked. Add direct deterministic regressions, including a newly added required context and a newer failing/pending run during collection. Re-run the reproducer; it must refuse.

## 2. Measured refresh default-base and final identity defect

/tmp/work0801-broker-base-repro.mts executes the actual YAML broker using fake API methods. It shows reruns=[77], refusal=null for a same-repository PR based on feature-untrusted-base while repository default_branch is main. Bind refresh targets to the trusted repository default branch, fail closed on absent/mismatched base identity, and revalidate open state/repository/base/head adjacent to the only rerun mutation. Retain exact eligible newest pull_request/workflow/PR/head selection and no older fallback. The corresponding fake broker reproduction must refuse with zero reruns. No real Actions rerun is performed by these reproducers.

## 3. Executable security regression coverage

The first candidate's new literal gate test largely checks source regex; its broker mutation negative covers HEAD movement only. Add execution of the real YAML gate script for valid stale-only C1-C7 carry-forward and refusal for missing/misaligned/empty codes, no/unauthorized/withdrawn approval, malformed/incorrect approval identity or incomplete conditions, failed/timed-out/unparseable collector. Assert the collector is never invoked when staleness is not the sole verdict defect. Add table-driven execution of the literal broker for wrong repo/base/source workflow/event/head, incomplete/newest run, malformed target and final identity drift, with zero rerun mutation. Preserve substantive hostile git-show/checkout/curl materialization regressions and all existing test cases/counts. Reuse the admitted test files and existing helpers; do not add unscoped files or alter the canonical C1-C7 collector/allowlist.

## 4. Auditable carry-forward output

The reduced APPROVAL_CARRY_FORWARD_COMPUTED notice currently relabels fields under the v1 schema. Emit complete computed facts/canonical receipt in native job logs/summary, preserving original approval SHA/URL, current successor HEAD, C1-C7 results, actual generating workflow-run provenance and the canonical disclaimer that this is not an independent review. Do not add write permissions or accept receipt comments/files as authority. The original PM verdict stays immutable.

## Verification and closeout

Use focused tests first, then actually run the required pnpm verify and pnpm test:db. Avoid redundant aggregate test reruns separate from verify unless a new failure warrants them. Record local DB guard REFUSED honestly; real writable proof must come from protected exact-HEAD staging CI. Run R-level and scope/diff checks. Update/create the same draft tier:T1 PR and own named proof only, preserving actual source SHA and genuine model/CLI/epoch history. Do not merge, self-approve, deploy or claim protected CI success before it exists. Return a genuine complete machine result; parent will finish exact-head CI/proof/ERV and PM packet after review.

Executor time discipline: after actual local verification and genuine phase completion, report protected exact-HEAD CI as pending if it is still queued/running. Do not spend the bounded child attempt waiting on GitHub CI or attempt to manufacture an executor SUCCESS sidecar before returning. The outer wrapper will record measured provenance and the parent will finish protected CI, staging receipts and final exact-head executor posting. Keep every pending/red gate explicit; this is not product completion or merge permission.
