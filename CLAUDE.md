# AI Code Reviewer — Project Context

## What this project is

A GitHub App that automatically reviews Pull Requests using AI. When a user enables a repo,
the app receives webhook events, fetches diffs, and posts review comments via Claude.

**Current production flow:**
```
PR opened → webhook hit → fetch diff (GitHub API) → LLM review → post PR comments
```

**What we are building toward:** A full RAG-powered review system where the LLM has 4 layers
of context beyond just the diff — described in detail below.

---

## Architecture overview

### Auth & GitHub integration (already built)
- Users OAuth into the app and grant GitHub permissions
- User enables specific repos from a dashboard
- App stores installation tokens per user/org
- Webhook endpoint receives `pull_request` events (opened, synchronize, reopened)

### Core review pipeline (current)
1. Receive `pull_request` webhook from GitHub
2. Fetch PR diff via GitHub API using installation token
3. Send diff to Claude API
4. Parse response and post inline comments + PR summary via GitHub Review API

---

## RAG system — what we are building

The goal is to move from "LLM sees only the diff" to "LLM sees the diff + 4 knowledge layers."

### Layer 1 — Codebase context (highest priority, build first)
**Purpose:** Find similar functions/classes already in the codebase so the LLM can flag
inconsistencies and reference existing patterns.

**Trigger:** When a user enables a repo → clone it → index it
**Re-index trigger:** Every push webhook (only re-index changed files, not full re-index)

**How to chunk:** Use Tree-sitter AST parsing. Chunk at function/class/method boundaries —
NOT by character count. Each chunk = one complete meaningful unit of code.

**Metadata to store per chunk:**
```json
{
  "repo_id": "string",
  "file_path": "string",
  "function_name": "string",
  "start_line": "number",
  "end_line": "number",
  "language": "python|typescript|go|...",
  "last_modified": "ISO timestamp"
}
```

**At review time:** For each changed file in the diff, embed the new code and retrieve
top 5-10 similar functions from the same repo (filter by `repo_id`).

### Layer 2 — Review memory (the compounding moat)
**Purpose:** Store every review decision. The system gets smarter per-repo over time.
Similar patterns that were flagged and accepted before should be flagged again with
higher confidence.

**Stored after every review:**
- The diff chunk that was reviewed
- The comment we generated
- Whether the dev accepted or dismissed it (track via GitHub review resolution webhook)
- Severity, category, timestamp

**At review time:** Retrieve top 3 similar past reviews for each diff chunk.
Weight results toward `accepted=true` patterns.

**Categories:** `security`, `performance`, `style`, `correctness`, `architecture`, `test-coverage`

### Layer 3 — Rules and standards
**Purpose:** Index the repo's own documentation so comments cite the team's own rules.

**What to index:** `CONTRIBUTING.md`, `README.md`, `.eslintrc`, `pyproject.toml`,
linting configs (parse rules as text), ADRs in `docs/`, any `docs/` folder.

**Search strategy:** Hybrid search — BM25 (keyword) + semantic. Rules often have
exact keywords like "never use eval" that keyword search catches better.

**At review time:** Retrieve top 3 relevant rules per diff chunk using hybrid search.

### Layer 4 — Dependency graph (advanced)
**Purpose:** Know the blast radius of every change. When `getUserById()` changes,
know that 14 other functions call it and 3 are in payment flows.

**How:** Parse imports with Tree-sitter → build a directed graph (NetworkX or similar).
Store in a graph structure queryable by function name.

**At review time:** For each changed function, return:
- Direct callers
- Whether any caller is in a "critical path" (payment, auth, data-write)
- Call depth / impact score

**Inject into prompt:** "Note: `processPayment()` is called by 8 functions including
`checkout()` and `subscriptionRenew()`. Review thoroughly."

---

## Vector database

Use **pgvector** (if Postgres already in stack) or **Pinecone** (simpler to start).

Every record has:
- `vector` — the embedding (use `text-embedding-3-small` from OpenAI or equivalent)
- `metadata` — always include `repo_id` for filtering (never retrieve across repos)
- `type` — `"code"` | `"review"` | `"rule"` — so we can filter by layer

**Critical:** Always filter by `repo_id` before doing similarity search. Never mix
context across different users' repos.

---

## Prompt construction

Assemble the final LLM prompt like this — run all 4 retrievals in parallel, then compress:

```python
def build_review_prompt(diff, repo_id):
    # Retrieve from all 4 layers in parallel
    similar_code   = codebase_index.query(embed(diff), filter={"repo_id": repo_id}, top_k=10)
    past_reviews   = review_memory.query(embed(diff),  filter={"repo_id": repo_id}, top_k=5)
    relevant_rules = hybrid_search_rules(diff, repo_id, top_k=5)
    blast_radius   = get_blast_radius(extract_changed_functions(diff))

    # Compress before sending — do not dump raw retrieved text
    context = compress_context([similar_code, past_reviews, relevant_rules], query=diff)

    return f"""
You are a senior engineer reviewing a PR for this specific codebase.

## Diff to review:
{diff}

## Similar code patterns already in this codebase:
{context.similar_code}

## Past review decisions on similar patterns:
{context.past_reviews}

## Relevant coding standards for this repo:
{context.rules}

## Blast radius — functions that call the changed code:
{blast_radius}

Review the diff. For each issue found:
- Reference the specific codebase pattern it violates (with file + function name)
- Cite the relevant rule from their own standards if applicable
- Note if a similar issue was flagged and accepted in a previous review
- Rate severity: critical / high / medium / low
- For critical issues, suggest the fix with a code snippet
"""
```

---

## Build order / roadmap

| Phase | What to build | Why |
|---|---|---|
| **Week 1-2** | Layer 1 — repo indexing on enable, retrieve similar functions at review time | Biggest quality jump, standalone value |
| **Week 3** | Layer 3 — index CONTRIBUTING.md + linting configs | Low effort, high user delight |
| **Week 4-6** | Layer 2 — store reviews, track accept/dismiss, feed back into retrieval | The compounding moat |
| **Month 2+** | Layer 4 — AST import graph, blast radius scoring | Hardest, strongest differentiator |
| **Ongoing** | Reranking — retrieve 20 chunks per layer, rerank to top 5 before prompt | Quality up, token cost down |

---

## Key technical decisions

- **AST parsing:** Use Tree-sitter (supports Python, TypeScript, Go, Java, Ruby, etc.)
  Do NOT use regex or line-based splitting for code chunking.

- **Embedding model:** `text-embedding-3-small` (OpenAI) or `voyage-code-2` (Voyage AI —
  specifically trained on code, better for Layer 1)

- **Chunking strategy:** Function/class level via AST. With 50-token overlap at boundaries
  to avoid losing context at chunk edges.

- **Reranking:** Use Cohere Rerank or a local cross-encoder model. Always retrieve 20,
  rerank to 5, before building the final prompt.

- **Context compression:** Do not pass raw retrieved chunks to the LLM. Score each
  sentence by similarity to the query, keep only top sentences. Target 3-4x reduction.

- **Hybrid search for rules (Layer 3):** Use BM25 (via `rank_bm25` lib) for keyword
  matching + vector search for semantic. Merge with Reciprocal Rank Fusion (RRF).

---

## GitHub integration details

- **Webhook events subscribed:** `pull_request` (opened, synchronize, reopened),
  `pull_request_review` (for tracking accept/dismiss in Layer 2)
- **GitHub API used:**
  - `GET /repos/{owner}/{repo}/pulls/{pull_number}/files` — get changed files + diffs
  - `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` — post review with comments
  - `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments` — inline line comments
- **Auth:** GitHub App installation tokens (short-lived, refresh per request)

---

## What good output looks like

Bad comment (current state — generic):
> "This SQL query might be vulnerable to SQL injection."

Good comment (RAG-powered):
> "This pattern is inconsistent with how `getUserById()` is written in `auth/repository.py`
> (line 42), which uses parameterized queries. Your CONTRIBUTING.md (Rule 7) requires
> parameterized queries for all DB calls. A similar issue was flagged and accepted in PR #34.
> **Suggested fix:**
> ```python
> user = db.query("SELECT * FROM users WHERE id = %s", (user_id,))
> ```"

---

## Competitors doing this well
- **CodeRabbit** — strong on blast radius / dependency awareness
- **Cubic AI** — strong on per-repo learning over time

Our moat: the review memory layer (Layer 2) that learns per-repo from accepted/dismissed
decisions. Every review makes the next one better for that specific team.

---

## Coding conventions for this project

- All retrieval functions are async
- Always filter vector queries by `repo_id` — never cross-repo retrieval
- Log retrieval latency per layer (target: all 4 layers < 300ms total)
- Never store raw GitHub tokens in the vector DB metadata
- Each PR review job should be idempotent — safe to retry on failure

## When making architectural changes

Ask before changing:
- The chunking strategy (AST boundaries are load-bearing)
- The vector DB schema (adding fields is fine, changing IDs breaks existing index)
- The prompt structure (test on 5 real PRs before shipping changes)