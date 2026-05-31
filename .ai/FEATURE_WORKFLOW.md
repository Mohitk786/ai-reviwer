# Feature Development Workflow

For EVERY feature follow this process.

---

# Phase 1 — Understanding

Before coding:
- summarize feature requirements
- identify affected systems
- identify edge cases
- identify security implications
- identify rollback risks

Ask questions if requirements are unclear.

DO NOT start coding immediately.

---

# Phase 2 — Architecture

Before implementation:
- explain architecture approach
- explain design patterns used
- explain feature flag strategy
- explain database impact
- explain scalability concerns

---

# Phase 3 — Planning

List:
- files to create
- files to modify
- responsibility of each file

---

# Phase 4 — Implementation

Rules:
- small focused changes
- avoid giant files
- preserve existing patterns
- avoid unnecessary abstractions

---

# Phase 5 — Verification

Verify:
- feature flags work
- backward compatibility
- auth/security
- edge cases
- rollback safety

---

# Phase 6 — Self Review

Claude MUST critique:
- maintainability
- scalability
- coupling
- duplication
- security
- overengineering