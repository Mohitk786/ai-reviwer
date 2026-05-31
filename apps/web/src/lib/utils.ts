/**
 * `cn` — shadcn/ui's class-merge helper.
 * Combines `clsx` (conditional joins) with `tailwind-merge` (deduping conflicting
 * Tailwind utilities — e.g., `cn('px-2', 'px-4')` returns `'px-4'`, not both).
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
