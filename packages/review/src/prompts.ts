/**
 * Prompt templates for the AI code review pipeline.
 *
 * These are the only place review prompts live. Keep them here so they can be
 * tuned without touching orchestration logic.
 */

export const FILE_REVIEW_SYSTEM = `You are an expert AI code reviewer. Your job is to identify bugs, security vulnerabilities, and significant code quality problems in pull request diffs.

Rules:
- Only comment on lines that are present in the diff (added "+" lines and context " " lines — not removed "-" lines).
- Line numbers must be actual file line numbers (new-file side, 1-indexed), NOT diff position offsets.
- Be concise and actionable. Skip trivial style nits.
- Severity guide: INFO=suggestion, WARNING=potential bug/smell, ERROR=definite bug or security issue, CRITICAL=data loss/security breach risk.
- Return at most 10 comments per file. Prioritize the highest severity issues.
- When similar code already exists in the codebase, reference it by file path and function name (e.g. "inconsistent with getUserById() in src/auth/repository.ts").
- Respond ONLY with valid JSON. No markdown fences. No preamble.`;

export function buildFileReviewPrompt(opts: {
  prTitle: string;
  prBody?: string;
  filePath: string;
  patch: string;
  similarCode?: Array<{
    filePath: string;
    functionName: string | null;
    startLine: number;
    endLine: number;
    content: string;
  }>;
}): string {
  const context = opts.prBody
    ? `PR title: ${opts.prTitle}\nPR description: ${opts.prBody.slice(0, 500)}`
    : `PR title: ${opts.prTitle}`;

  const codebaseContext =
    opts.similarCode && opts.similarCode.length > 0
      ? `\n\n## Similar patterns already in this codebase:\n${opts.similarCode
          .map((c) => {
            const loc = c.functionName
              ? `${c.filePath} — ${c.functionName}() (lines ${c.startLine}–${c.endLine})`
              : `${c.filePath} (lines ${c.startLine}–${c.endLine})`;
            return `### ${loc}\n\`\`\`\n${c.content.slice(0, 600)}\n\`\`\``;
          })
          .join('\n\n')}`
      : '';

  return `${context}${codebaseContext}

File: ${opts.filePath}

Diff:
\`\`\`diff
${opts.patch.slice(0, 12000)}
\`\`\`

Output JSON with this exact shape:
{
  "comments": [
    {
      "line": <integer — new-file line number>,
      "side": "RIGHT",
      "severity": "INFO" | "WARNING" | "ERROR" | "CRITICAL",
      "body": "<markdown explanation>",
      "suggestion": "<optional replacement code>"
    }
  ],
  "fileSummary": "<optional one-line summary>"
}`;
}

export const PR_SUMMARY_SYSTEM = `You are an expert AI code reviewer. Write a concise summary of a completed pull request review. Be direct and informative. Respond ONLY with valid JSON. No markdown fences.`;

export function buildPrSummaryPrompt(opts: {
  prTitle: string;
  fileSummaries: Array<{ path: string; summary: string; commentCount: number }>;
  totalComments: number;
}): string {
  const fileLines = opts.fileSummaries
    .map((f) => `- ${f.path} (${f.commentCount} comment${f.commentCount !== 1 ? 's' : ''}): ${f.summary}`)
    .join('\n');

  return `PR: "${opts.prTitle}"
Files reviewed: ${opts.fileSummaries.length}
Total comments: ${opts.totalComments}

Per-file summaries:
${fileLines || '(no issues found)'}

Write a 2-4 sentence PR summary covering: what changes, key issues found, overall assessment.

Output JSON:
{
  "summary": "<your summary here>"
}`;
}
