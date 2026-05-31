/**
 * Zod schemas for validating structured LLM output from the review pipeline.
 *
 * The LLM is instructed to return JSON. We parse and validate with these schemas
 * before writing anything to the DB or posting to GitHub. Unknown fields are stripped
 * to avoid surprises downstream.
 */

import { z } from 'zod';

export const ReviewSeverity = z.enum(['INFO', 'WARNING', 'ERROR', 'CRITICAL']);
export type ReviewSeverityKind = z.infer<typeof ReviewSeverity>;

export const FileReviewCommentSchema = z.object({
  /** Actual new-file line number (1-indexed). Validated against commentableLines before use. */
  line: z.number().int().positive(),
  /** Which diff side. Right = new file (the common case). Left = deleted content. */
  side: z.enum(['LEFT', 'RIGHT']).default('RIGHT'),
  severity: ReviewSeverity,
  /** Markdown body. Truncated to 5000 chars before posting to stay well under GitHub's 65k limit. */
  body: z.string().min(1).max(5000),
  /** Optional suggested replacement code block. */
  suggestion: z.string().max(2000).optional(),
});
export type FileReviewComment = z.infer<typeof FileReviewCommentSchema>;

export const FileReviewOutputSchema = z.object({
  comments: z.array(FileReviewCommentSchema).max(25).default([]),
  /** One-line summary of this file's changes and findings. */
  fileSummary: z.string().max(300).optional(),
});
export type FileReviewOutput = z.infer<typeof FileReviewOutputSchema>;

export const PrSummaryOutputSchema = z.object({
  /** 2-4 sentence review summary posted as the GitHub review body. */
  summary: z.string().min(1).max(2000),
});
export type PrSummaryOutput = z.infer<typeof PrSummaryOutputSchema>;
