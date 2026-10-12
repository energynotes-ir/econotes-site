# Baseline Governance

## 1. Baseline Roles

- Product / Requirement Baseline: confirmed requirement sources, target state, goals and scope, users / scenarios, acceptance / verification criteria, non-goals, workflow constraints, open questions, change records, and approved requirement intent.
- Architecture / Runtime Boundary Baseline: canonical owner, contract, source-of-truth boundary, dependency direction, compatibility, runtime-ready boundary, and retirement state.

## 2. Design Defect

A confirmed error, gap, contradiction, or wrong abstraction in the relevant requirement, design, or baseline.

- Correct the defective requirement, design, or baseline first.
- Then align implementation to the corrected baseline.
- Do not patch implementation around a defective baseline.

## 3. Implementation Drift

Implementation, plan, review, or documentation has deviated from a confirmed, correct, unchanged requirement or architecture baseline.

- Return to the baseline by the simplest stable path.
- Do not update the baseline to match drift without explicit review.

## 4. Compatibility Aliases

- Architecture Defect means an architecture-scoped Design Defect.
- Architecture Drift means an architecture-scoped Implementation Drift.
- Report findings as Design Defect or Implementation Drift and identify scope as requirements, architecture, or both.

## 5. Baseline Check Protocol

Before non-trivial changes:

1. Read the latest Product / Requirement Baseline candidate.
2. Read the latest Architecture / Runtime Boundary Baseline candidate.
3. Compare work against acceptance criteria and architecture ownership / contract boundaries.
4. Check for new anti-patterns not recorded in known risks.
5. Report aligned, Design Defect, Implementation Drift, missing authority, or needs clarification, with scope.

## 6. Architecture Review

After each non-trivial change, review ownership integrity, module boundaries, contract changes, cascade proliferation, dependency direction, retirement completeness, and net complexity.

## 7. Hard Boundaries

- This file governs the EcoNotes Aegis workspace.
- Baseline snapshots are evidence, not authority.
- ADRs record decisions and do not replace baseline governance.
- Changes to this governance file require explicit user review.
