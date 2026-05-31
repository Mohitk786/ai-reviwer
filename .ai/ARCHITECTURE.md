# Project Architecture

# Backend Structure

src/server/
  controllers/
  services/
  repositories/
  domain/
  jobs/
  events/

## Rules

### Controllers
Responsible for:
- request validation
- auth checks
- calling services

Controllers MUST NOT:
- access DB directly
- contain business logic

---

### Services
Responsible for:
- business logic
- workflows
- orchestration

Services MAY:
- call repositories
- call external APIs

Services MUST NOT:
- render UI
- access HTTP request objects directly

---

### Repositories
Responsible for:
- DB queries only

Repositories MUST NOT:
- contain business logic

---

# Frontend Structure

src/client/
  components/
  hooks/
  services/
  pages/

## Rules

### Components
Only rendering/UI logic.

### Hooks
Contain reusable UI/business logic.

### Services
API communication layer.

---

# State Management Rules

- avoid unnecessary global state
- prefer local state first
- use caching carefully

---

# Feature Flag Strategy

All feature flags live in:

src/shared/featureFlags.ts

No scattered feature checks allowed.

---

# Error Handling Rules

- never expose internal errors
- use centralized error handling
- use typed error responses