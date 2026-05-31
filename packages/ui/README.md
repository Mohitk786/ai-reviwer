# @repo/ui

Cross-app design primitives + utility helpers (`cn()`, `lucide-react` re-exports).

## What lives here

- shadcn/ui primitives that are referenced by more than one app
- `lib/cn.ts` — Tailwind class-merge helper (`clsx` + `tailwind-merge`)
- Shared icons / logo / brand components

## What does NOT live here

- App-specific components (those live next to the route in `apps/web/src/components`)
- New shadcn primitives unless they're actually shared. Default: drop primitives in
  `apps/web/src/components/ui/` (the standard shadcn convention) until we have a second
  app that needs them.

## Pattern

```tsx
import { cn } from '@repo/ui/lib/cn';
import { Button } from '@repo/ui/Button';
```
