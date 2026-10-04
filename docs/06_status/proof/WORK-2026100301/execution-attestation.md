# Control-closure execution attestation

The historical Discord implementation at ca2ef310e6726a088f1a12e0d82d0e924ad8e2f7 ran in the desktop session; its precise model and effort remain unattested.

The 2026-10-04 control implementation and verification ran through the sanctioned ops:codex-exec entrypoint. Observed CLI header:

```text
OpenAI Codex v0.153.3
model: gpt-5.6-sol
provider: openai
reasoning effort: medium
```

The parent returned SUCCESS with codex_exit_code 0, source_files_changed 2 and primary checkpoint provenance. The changed source files were the base-pinned shadow workflow and its regression test. Source commit: 4debf792778dc76de237ceacb8c91edaa805683f. The executor-generated immutable model-routing.json records this completed run; it is not an admission-only assertion.

Execution epoch: 19868c5b-555c-4780-8911-af50e2941367. The initial nested-dispatch attempts were interrupted, archived through the sanctioned checkpoint functions, and retained as failed history. The corrected task prohibited nested dispatch. No successful implementation or verification is attributed to the interrupted attempts.

Source-head focused tests: 217/217. Integrated scope/shadow tests after main resync: 78/78. Local full verification passed its static chain and refused the unidentified localhost DB target. Source-head CI verify and staging/T1 proof passed. The subsequent final HEAD must have its own CI/staging receipt binding; this historical source attestation does not substitute for that.
