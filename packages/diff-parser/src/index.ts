/**
 * @repo/diff-parser — Unified diff patch parser.
 *
 * Zero runtime dependencies. Pure transformation:
 *   `patch: string` (from GitHub list-PR-files API) → `ParsedPatch`
 *
 * Primary consumers:
 *   - @repo/review (PR-B3): filters LLM-suggested line comments to only
 *     those present in the diff before posting to GitHub.
 *   - GitHub Review API: uses actual file line numbers (`line` field + `side`)
 *     rather than the deprecated `position` integer.
 *
 * Public API:
 *   - `parsePatch(patch)` → `ParsedPatch`
 *   - `isCommentableLine(parsed, line)` → boolean
 *   - `diffStats(parsed)` → `{ hunks, additions, deletions }`
 */

export { parsePatch, isCommentableLine, diffStats } from './parser';
export type { ParsedPatch, DiffHunk, DiffLine } from './parser';
