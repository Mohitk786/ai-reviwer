import { z } from 'zod';

export const JobNames = {
  Hello: 'hello',

  // Code review pipeline
  ReviewPr: 'review.pr',

  // Codebase indexing (Layer 1)
  IndexRepository: 'index.repository',
  IndexFile: 'index.file',

  // Layer 2 — Review memory
  StoreReviewMemory: 'review.memory.store',

  // Layer 2 — Developer comment processing
  ProcessDeveloperComment: 'comment.developer.process',

  // Infrastructure
  WebhookProcess: 'webhook.process',
} as const;

export type JobName = (typeof JobNames)[keyof typeof JobNames];

export const jobSchemas = {
  [JobNames.Hello]: z.object({
    message: z.string(),
    correlationId: z.string().uuid().optional(),
  }),

  [JobNames.ReviewPr]: z.object({
    repositoryId: z.string(),
    installationId: z.string(),
    pullRequestNumber: z.number().int().positive(),
    commitSha: z.string().min(7).max(40),
    aiReviewId: z.string(),
    correlationId: z.string().uuid().optional(),
  }),

  [JobNames.IndexRepository]: z.object({
    repositoryId: z.string(),
    installationId: z.string(),
  }),

  [JobNames.IndexFile]: z.object({
    repositoryId: z.string(),
    installationId: z.string(),
    /** File path relative to repo root. */
    filePath: z.string(),
    /** Branch name or commit SHA to fetch the file at. */
    ref: z.string(),
  }),

  [JobNames.WebhookProcess]: z.object({
    deliveryId: z.string(),
  }),

  [JobNames.StoreReviewMemory]: z.object({
    repositoryId: z.string(),
    aiReviewId: z.string(),
  }),

  [JobNames.ProcessDeveloperComment]: z.object({
    repositoryId: z.string(),
    installationId: z.string(),
    pullRequestNumber: z.number().int().positive(),
    /** GitHub numeric ID of the developer's comment. */
    githubCommentId: z.number().int(),
    commentBody: z.string(),
    commenterLogin: z.string(),
    /** Present for inline diff comments — identifies which file the comment is on. */
    filePath: z.string().optional(),
    /** Line number for inline diff comments. */
    line: z.number().int().optional(),
    /** GitHub comment ID this is a reply to — used to match our AiReviewComment. */
    inReplyToCommentId: z.number().int().optional(),
    /** GitHub URL of the comment — stored in RepoKnowledge for attribution. */
    commentUrl: z.string().optional(),
  }),
} as const satisfies Record<JobName, z.ZodTypeAny>;

/** Narrowed payload type by job name. */
export type JobPayload<N extends JobName> = z.infer<(typeof jobSchemas)[N]>;
