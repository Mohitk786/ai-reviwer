/**
 * Unified diff patch parser.
 *
 * Converts the `patch` field from GitHub's "list PR files" API into a
 * structured representation that lets the review engine:
 *   - Know which lines on the new file are valid inline comment targets.
 *   - Pass actual file line numbers to the LLM and to the GitHub Review API.
 *
 * GitHub's new review comment API accepts a `line` field (actual file line
 * number) + `side` ('LEFT' | 'RIGHT') rather than the older `position`
 * integer (offset within the diff). This parser produces real file line
 * numbers so no secondary conversion is needed.
 *
 * Supported diff syntax:
 *   ` ` — context line (present on both sides)
 *   `+` — added line (right/new side only)
 *   `-` — removed line (left/old side only)
 *   `\` — "No newline at end of file" marker (ignored)
 *   `@@ -old_start[,old_count] +new_start[,new_count] @@[...]` — hunk header
 *
 * Binary files and files above GitHub's ~20 KB limit have no `patch` — callers
 * must check for undefined before calling parse.
 */

export interface DiffLine {
  type: 'context' | 'added' | 'removed';
  /** Line number in the old file. Undefined for added lines. */
  oldLine?: number;
  /** Line number in the new file. Undefined for removed lines. */
  newLine?: number;
  /** Line content without the leading `+`/`-`/` ` prefix. */
  content: string;
}

export interface DiffHunk {
  /** Starting line in the old file. */
  oldStart: number;
  /** Starting line in the new file. */
  newStart: number;
  lines: DiffLine[];
}

export interface ParsedPatch {
  hunks: DiffHunk[];
  /**
   * Set of new-file line numbers where an inline review comment may be placed.
   *
   * Includes context lines (both sides) and added lines (right/new side).
   * Does NOT include lines removed from the left side — those no longer exist
   * in the new file.
   */
  commentableLines: Set<number>;
}

// Matches: @@ -old_start[,old_count] +new_start[,new_count] @@ [optional context]
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parse a unified diff `patch` string into structured hunks + a set of
 * commentable new-file line numbers.
 *
 * Returns `{ hunks: [], commentableLines: new Set() }` for empty or blank patches.
 */
export function parsePatch(patch: string): ParsedPatch {
  const hunks: DiffHunk[] = [];
  const commentableLines = new Set<number>();

  if (!patch.trim()) {
    return { hunks, commentableLines };
  }

  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    // --- Hunk header ---
    const hunkMatch = HUNK_HEADER_RE.exec(raw);
    if (hunkMatch) {
      // Non-null assertion: regex guarantees group 1 and 2 are captured digits.
      oldLine = parseInt(hunkMatch[1]!, 10);
      newLine = parseInt(hunkMatch[2]!, 10);
      currentHunk = { oldStart: oldLine, newStart: newLine, lines: [] };
      hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) continue; // preamble before first hunk header

    // --- Diff lines ---
    if (raw.startsWith('+')) {
      currentHunk.lines.push({ type: 'added', newLine, content: raw.slice(1) });
      commentableLines.add(newLine);
      newLine++;
    } else if (raw.startsWith('-')) {
      currentHunk.lines.push({ type: 'removed', oldLine, content: raw.slice(1) });
      oldLine++;
    } else if (raw.startsWith(' ')) {
      currentHunk.lines.push({ type: 'context', oldLine, newLine, content: raw.slice(1) });
      commentableLines.add(newLine);
      oldLine++;
      newLine++;
    }
    // Lines starting with '\' ("No newline at end of file") are ignored.
  }

  return { hunks, commentableLines };
}

/**
 * Returns `true` if the given new-file line number is a valid target for an
 * inline review comment in this diff.
 *
 * The LLM may suggest commenting on lines that don't appear in the diff
 * (unchanged context outside all hunks). Filtering with this guard prevents
 * GitHub API 422 errors on review creation.
 */
export function isCommentableLine(parsed: ParsedPatch, line: number): boolean {
  return parsed.commentableLines.has(line);
}

/**
 * Returns a brief plain-text summary of the diff suitable for LLM context:
 * how many hunks, additions, deletions.
 */
export function diffStats(parsed: ParsedPatch): { hunks: number; additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of parsed.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'added') additions++;
      else if (line.type === 'removed') deletions++;
    }
  }
  return { hunks: parsed.hunks.length, additions, deletions };
}
