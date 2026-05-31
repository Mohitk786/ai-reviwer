/**
 * `cn` — Tailwind class-merge helper.
 *
 * `clsx` joins conditional class strings; `tailwind-merge` then deduplicates
 * conflicting utilities (e.g., `cn('px-2', 'px-4')` returns `'px-4'`, not both).
 * This pattern is the shadcn/ui convention; we re-export from `@repo/ui` so
 * any future second app can share the same helper without copy-paste.
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
