# PROOF: UTV2-####
MERGE_SHA: <exact PR head SHA — must match current HEAD, verified by executor-result-validator>

ASSERTIONS:
- [ ] <verifiable assertion 1 — tied to acceptance criteria>
- [ ] <verifiable assertion 2 — tied to acceptance criteria>

EVIDENCE:
```text
<paste exact command output, test results, or log excerpts here>
<must be verifiable, not narrative claims>
```

---

<!-- TEMPLATE INSTRUCTIONS (delete this section when using) -->
<!--
  This file is validated by .github/workflows/executor-result-validator.yml

  Required sections (all must be present):
    # PROOF:       — must include issue ID
    MERGE_SHA:     — must EXACTLY match the PR head SHA
    ASSERTIONS:    — at least one "- [ ]" or "- [x]" item
    EVIDENCE:      — at least one fenced code block with real output

  Rejected if:
    - Any section is missing
    - MERGE_SHA does not match current HEAD
    - Assertions or evidence are empty
    - Contains TODO, TBD, FIXME, PLACEHOLDER, or <fill-in>

  File location: docs/06_status/proof/UTV2-####.md
  Referenced by: Executor result comment "Proof Artifact:" field

  For T1 issues: this proof file supplements the full evidence bundle
    (docs/06_status/UTV2-####-EVIDENCE-BUNDLE.md per EVIDENCE_BUNDLE_TEMPLATE.md)
  For T2 issues: this may be the primary proof artifact
  For T3 issues: proof file is not required (CI only)
-->
