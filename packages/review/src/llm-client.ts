/**
 * LLM client for the review pipeline.
 *
 * Wraps `LLMProvider.chat()` with:
 *   - Prompt building (delegates to prompts.ts).
 *   - JSON extraction — strips any accidental markdown fences the model emits.
 *   - Zod validation of the response shape.
 *   - Fallback on parse failure (empty comments, generic summary) so a single
 *     malformed LLM response never fails the entire review.
 */

import type { LLMProvider } from '@repo/llm';
import type { Logger } from '@repo/observability';
import {
  FileReviewOutputSchema,
  PrSummaryOutputSchema,
  type FileReviewOutput,
  type PrSummaryOutput,
} from './schemas';
import {
  FILE_REVIEW_SYSTEM,
  buildFileReviewPrompt,
  PR_SUMMARY_SYSTEM,
  buildPrSummaryPrompt,
  EXPLAIN_COMMENT_SYSTEM,
  buildExplainCommentPrompt,
  CLASSIFY_DEV_COMMENT_SYSTEM,
  buildClassifyDevCommentPrompt,
  EXTRACT_KNOWLEDGE_SYSTEM,
  buildExtractKnowledgePrompt,
} from './prompts';

/** Strips ```json ... ``` or ``` ... ``` fences if the model wraps its output. */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  return raw.trim();
}

export type DevCommentIntent = 'QUESTION' | 'CODEBASE_KNOWLEDGE' | 'ACCEPTED' | 'DISMISSED' | 'UNRELATED';

export interface DevCommentClassification {
  intent: DevCommentIntent;
  confidence: number;
  reasoning: string;
}

export interface ExtractedKnowledge {
  content: string;
  kind: string;
  isUseful: boolean;
}

export interface ReviewLLMClient {
  reviewFile(opts: {
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
  }): Promise<FileReviewOutput>;

  summarizePr(opts: {
    prTitle: string;
    fileSummaries: Array<{ path: string; summary: string; commentCount: number }>;
    totalComments: number;
  }): Promise<PrSummaryOutput>;

  /** Classify the intent of a developer's comment on an AI review finding. */
  classifyDevComment(opts: {
    aiComment: string;
    developerComment: string;
  }): Promise<DevCommentClassification>;

  /** Generate a clear explanation of a review finding in response to a developer question. */
  explainComment(opts: {
    filePath: string;
    line: number;
    diffChunk: string;
    originalComment: string;
    developerQuestion: string;
  }): Promise<string>;

  /** Extract reusable codebase knowledge from a developer comment. */
  extractKnowledge(opts: {
    developerComment: string;
    filePath?: string;
  }): Promise<ExtractedKnowledge>;
}

export function createReviewLLMClient(provider: LLMProvider, logger: Logger): ReviewLLMClient {
  const log = logger.child({ component: 'review-llm-client' });

  return {
    async reviewFile(opts) {
      const userPrompt = buildFileReviewPrompt({
        ...opts,
        similarCode: opts.similarCode,
      });

      let raw: string;
      try {
        const result = await provider.chat({
          messages: [
            { role: 'system', content: FILE_REVIEW_SYSTEM },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          maxTokens: 2048,
        });
        raw = result.content;
        log.debug(
          { filePath: opts.filePath, inputTokens: result.inputTokens, outputTokens: result.outputTokens },
          'file review LLM call complete',
        );
      } catch (err) {
        log.warn({ err, filePath: opts.filePath }, 'LLM call failed — returning empty review');
        return { comments: [] };
      }

      const parsed = FileReviewOutputSchema.safeParse(JSON.parse(extractJson(raw)));
      if (!parsed.success) {
        log.warn({ issues: parsed.error.issues, filePath: opts.filePath }, 'LLM output failed schema validation — returning empty review');
        return { comments: [] };
      }

      return parsed.data;
    },

    async summarizePr(opts) {
      if (opts.fileSummaries.length === 0 && opts.totalComments === 0) {
        return { summary: `No significant issues found in "${opts.prTitle}". The changes look clean.` };
      }

      const userPrompt = buildPrSummaryPrompt(opts);

      let raw: string;
      try {
        const result = await provider.chat({
          messages: [
            { role: 'system', content: PR_SUMMARY_SYSTEM },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          maxTokens: 512,
        });
        raw = result.content;
      } catch (err) {
        log.warn({ err }, 'PR summary LLM call failed — using fallback summary');
        return { summary: `Review completed for "${opts.prTitle}". Found ${opts.totalComments} comment${opts.totalComments !== 1 ? 's' : ''}.` };
      }

      try {
        const parsed = PrSummaryOutputSchema.safeParse(JSON.parse(extractJson(raw)));
        if (parsed.success) return parsed.data;
      } catch {
        // fall through to fallback
      }

      log.warn({ raw: raw.slice(0, 200) }, 'PR summary schema validation failed — using fallback');
      return { summary: `Review completed for "${opts.prTitle}". Found ${opts.totalComments} comment${opts.totalComments !== 1 ? 's' : ''}.` };
    },

    async classifyDevComment(opts) {
      const userPrompt = buildClassifyDevCommentPrompt(opts);
      try {
        const result = await provider.chat({
          messages: [
            { role: 'system', content: CLASSIFY_DEV_COMMENT_SYSTEM },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.0,
          maxTokens: 256,
        });
        const parsed = JSON.parse(extractJson(result.content)) as {
          intent: DevCommentIntent;
          confidence: number;
          reasoning: string;
        };
        if (!parsed.intent) throw new Error('missing intent field');
        return parsed;
      } catch (err) {
        log.warn({ err }, 'classifyDevComment failed — defaulting to UNRELATED');
        return { intent: 'UNRELATED', confidence: 0, reasoning: 'classification failed' };
      }
    },

    async explainComment(opts) {
      const userPrompt = buildExplainCommentPrompt(opts);
      try {
        const result = await provider.chat({
          messages: [
            { role: 'system', content: EXPLAIN_COMMENT_SYSTEM },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          maxTokens: 1024,
        });
        return result.content.trim();
      } catch (err) {
        log.warn({ err }, 'explainComment LLM call failed');
        return opts.originalComment;
      }
    },

    async extractKnowledge(opts) {
      const userPrompt = buildExtractKnowledgePrompt(opts);
      try {
        const result = await provider.chat({
          messages: [
            { role: 'system', content: EXTRACT_KNOWLEDGE_SYSTEM },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.0,
          maxTokens: 256,
        });
        const parsed = JSON.parse(extractJson(result.content)) as ExtractedKnowledge;
        if (!parsed.content || !parsed.kind) throw new Error('missing fields');
        return parsed;
      } catch (err) {
        log.warn({ err }, 'extractKnowledge LLM call failed');
        return { content: '', kind: 'CONVENTION', isUseful: false };
      }
    },
  };
}
