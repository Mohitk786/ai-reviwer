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
- It is not necessary to comment on every single file changes if there is no issue/bug found in the file.
- Severity guide: INFO=suggestion, WARNING=potential bug/smell, ERROR=definite bug or security issue, CRITICAL=data loss/security breach risk.
- Return at most 10 comments per file. Prioritize the highest severity issues.
- When similar code already exists in the codebase, reference it by file path and function name (e.g. "inconsistent with getUserById() in src/auth/repository.ts").
- If past review context shows a finding was "❌ dismissed by team", do NOT flag the same issue again unless severity is CRITICAL.
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
  pastReviewsContext?: string;
  repoKnowledgeContext?: string;
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

  const pastReviews = opts.pastReviewsContext ?? '';
  const repoKnowledge = opts.repoKnowledgeContext ?? '';

  return `${context}${codebaseContext}${pastReviews}${repoKnowledge}

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

// ---------------------------------------------------------------------------
// Layer 2 — past-reviews context block (injected into buildFileReviewPrompt)
// ---------------------------------------------------------------------------

export function buildPastReviewsContext(reviews: Array<{
  filePath: string;
  pullRequestNumber: number;
  commentBody: string;
  severity: string;
  outcome: string;
}>): string {
  if (reviews.length === 0) return '';
  const lines = reviews.map((r) => {
    const outcomeLabel =
      r.outcome === 'ACCEPTED' ? '✅ accepted by team' :
      r.outcome === 'DISMISSED' ? '❌ dismissed by team' :
      '⏳ no decision yet';
    return `- [${r.severity} · ${outcomeLabel}] in \`${r.filePath}\` (PR #${r.pullRequestNumber})\n  "${r.commentBody.slice(0, 200)}${r.commentBody.length > 200 ? '…' : ''}"`;
  });
  return `\n\n## Past review decisions on similar patterns in this repo:\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Layer 2 — repo knowledge context block
// ---------------------------------------------------------------------------

export function buildRepoKnowledgeContext(knowledge: Array<{
  content: string;
  kind: string;
}>): string {
  if (knowledge.length === 0) return '';
  const lines = knowledge.map((k) => `- [${k.kind}] ${k.content}`);
  return `\n\n## Codebase knowledge for this repo (learned from developer feedback):\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Layer 2 — developer asked a question on an AI comment → explain it
// ---------------------------------------------------------------------------

export const EXPLAIN_COMMENT_SYSTEM = `You are a senior AI code reviewer. A developer has asked you to explain one of your review comments in more detail. Be clear, specific, and helpful. Reference the exact code from the diff. Explain: (1) what the issue is, (2) why it matters, (3) how to fix it with a concrete example if applicable.`;

export function buildExplainCommentPrompt(opts: {
  filePath: string;
  line: number;
  diffChunk: string;
  originalComment: string;
  developerQuestion: string;
}): string {
  return `You previously posted this review comment:

**File:** \`${opts.filePath}\` (line ${opts.line})

**Your comment:** ${opts.originalComment}

**The diff that triggered this comment:**
\`\`\`diff
${opts.diffChunk.slice(0, 3000)}
\`\`\`

**The developer is asking:** "${opts.developerQuestion}"

Explain your finding clearly. Be specific about: what the problem is, why it matters, and how to fix it.`;
}

// ---------------------------------------------------------------------------
// Layer 2 — classify a developer comment (question / knowledge / feedback)
// ---------------------------------------------------------------------------

export const CLASSIFY_DEV_COMMENT_SYSTEM = `You are a classifier. A developer has commented on a pull request that was reviewed by an AI. Classify the developer's comment into exactly one of these intents:

- QUESTION: The developer is asking for clarification or explanation of the AI's finding.
- CODEBASE_KNOWLEDGE: The developer is providing factual information about the codebase, architecture, or feature behaviour (e.g. "we use soft deletes here", "this is intentional because X").
- ACCEPTED: The developer acknowledges the issue is valid (e.g. "good catch", "fixing this", "you're right").
- DISMISSED: The developer says the finding is not applicable or incorrect (e.g. "this is intentional", "not an issue here", "false positive").
- UNRELATED: The comment is not about the AI review finding.

Respond ONLY with valid JSON. No markdown fences.`;

export function buildClassifyDevCommentPrompt(opts: {
  aiComment: string;
  developerComment: string;
}): string {
  return `AI review comment: "${opts.aiComment}"

Developer's reply: "${opts.developerComment}"

Classify the developer's intent.

Output JSON:
{
  "intent": "QUESTION" | "CODEBASE_KNOWLEDGE" | "ACCEPTED" | "DISMISSED" | "UNRELATED",
  "confidence": 0.0,
  "reasoning": "<one sentence>"
}`;
}

// ---------------------------------------------------------------------------
// Layer 2 — extract structured knowledge from a developer comment
// ---------------------------------------------------------------------------

export const EXTRACT_KNOWLEDGE_SYSTEM = `You are a knowledge extractor. A developer has commented on a pull request with information about their codebase. Extract this as a clean, reusable knowledge statement that will help an AI reviewer understand this codebase better in future reviews.

Output a concise, factual statement (1-2 sentences). Do not include opinions or subjective judgements. Only extract verifiable facts about the codebase, architecture, or feature behaviour.

Respond ONLY with valid JSON. No markdown fences.`;

export function buildExtractKnowledgePrompt(opts: {
  developerComment: string;
  filePath?: string;
}): string {
  const context = opts.filePath ? `\nContext: this comment was made on file \`${opts.filePath}\`.` : '';
  return `Developer's comment: "${opts.developerComment}"${context}

Extract the codebase knowledge from this comment.

Output JSON:
{
  "content": "<clean factual knowledge statement>",
  "kind": "ARCHITECTURE" | "CONVENTION" | "FEATURE" | "CONSTRAINT" | "TERMINOLOGY",
  "isUseful": true
}

Set isUseful to false if the comment contains no extractable codebase knowledge.`;
}

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
