# Preferred Engineering Patterns

## Service Pattern

Business logic belongs in services.

Example:
UserService
BillingService
BookingService

---

## Repository Pattern

DB access belongs in repositories.

Example:
UserRepository
BookingRepository

---

## Factory Pattern

Use factories for:
- provider creation
- strategy selection
- adapter creation

Avoid giant switch statements everywhere.

---

## Singleton Pattern

Use only for:
- config
- logger
- connection managers

Avoid global mutable state.

---

## Adapter Pattern

Use adapters for:
- third-party integrations
- external APIs
- provider normalization

---

## Feature Flag Pattern

All flags centralized.

NEVER scatter:
if (featureEnabled)

across entire codebase.

---

## Error Handling Pattern

Use:
- typed errors
- centralized error handling
- structured logging

Avoid:
- random try/catch everywhere

---

## Dependency Rules

Prefer:
- dependency injection
- composition

Avoid:
- tight coupling
- hidden dependencies