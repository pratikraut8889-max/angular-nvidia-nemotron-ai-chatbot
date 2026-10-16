# ConversaNemo.ai release checklist

## Configuration

- [ ] Set `MONGODB_URI`; the server no longer silently falls back to a local MongoDB instance. Set `MONGODB_DB_NAME` if using a non-default database.
- [ ] Set `NVIDIA_EMBEDDING_MODEL=nvidia/nemotron-3-embed-1b` and plan a re-index for vectors created with the retired model.
- [ ] Set a unique `JWT_SECRET` with at least 32 random characters.
- [ ] Set `MONGODB_URI`, `NVIDIA_API_KEY`, and (if live search is enabled) `TAVILY_API_KEY` in the deployment dashboard.
- [ ] Keep provider keys out of Angular/browser bundles and Git history.
- [ ] Verify `gs` (Ghostscript) exists in the server runtime.

## Database / RAG

- [ ] Confirm the MongoDB indexes were created at application startup.
- [ ] For larger collections, create Atlas Vector Search index `document_vector_index` on `documentChunks`, including vector path `embedding` with 2,048 dimensions and filter fields `userId`, `documentId`, and `embeddingModel`.
- [ ] Enable `MONGODB_VECTOR_SEARCH_ENABLED=true` only after the Atlas index is ready.
- [ ] Test upload, question retrieval, document deletion, and conversation attachment persistence.
- [ ] Verify user A cannot list, select, retrieve, or delete user B's documents. Re-upload legacy docs that have no `embeddingModel` metadata.
- [ ] Verify unsupported files, invalid signatures, empty text, oversized files, and scanned PDFs fail cleanly.

## Security

- [ ] Users must log in again after changing `JWT_SECRET`.
- [ ] Back up and review pre-existing conversations that may lack a valid `userId` due to the former JWT `id` / route `userId` mismatch; migrate ownership only when it can be established safely.
- [ ] Legacy Cryptr accounts migrate to scrypt after successful login; set `CRYPTR_LEGACY_SECRET` to the old key if it differs from `SecretKEy`.
- [ ] Replace `localStorage` bearer tokens with secure HTTP-only cookies before using this for sensitive/public production workloads.
- [ ] Current MongoDB-backed fixed-window limits are shared across app instances; for high-volume traffic, move rate-limit counters to Redis or an API gateway and add per-user AI cost quotas.
- [ ] Confirm privacy/retention notice covers text sent to NVIDIA and web queries sent to Tavily.

## Build / operations

- [ ] `npm install`
- [ ] `npm run build`
- [ ] `npm run serve:ssr`
- [ ] Run tests against a disposable MongoDB database and valid provider credentials.
- [ ] Configure monitoring, alerts, backups, and a restore test.
- [ ] Consider moving document ingestion to a background queue before handling high upload volum

# ConversaNemo.ai production-readiness roadmap

This is a prioritized plan for moving ConversaNemo.ai from a learning/demo project toward a reliable public application. The items below are recommendations and acceptance criteria, not claims that every item is already implemented.

## Phase 1 — Release safety (P0, before public launch)

- [ ] Install from the lockfile and make `npm ci`, `npm run build`, and automated tests pass in CI.
- [ ] Confirm all secrets are server-side environment variables; rotate any key that was ever committed, logged, or shared.
- [ ] Review authentication end-to-end: token/session expiry, password reset, signup/login rate limits, secure cookie/token handling, logout, and ownership checks on every conversation and document route.
- [ ] Add security headers, a restrictive CORS policy, body-size limits, request timeouts, and structured error responses. Do not expose stack traces, prompts, tokens, or document contents in logs.
- [ ] Decide and document upload limits, retention period, deletion semantics, and the types of information users must not upload. Include a privacy policy and terms before collecting real user data.
- [ ] Make uploads resilient: validate MIME type and file signature, reject malformed files, bound extraction time and memory, and isolate parsers where practical.
- [ ] Confirm production uses HTTPS and a durable MongoDB deployment with access controls, backups, and a tested restore procedure.

**Acceptance gate:** build and tests pass; one user cannot read, select, or delete another user's conversations/documents; environment secrets are not exposed to the browser; backups can be restored.

## Phase 2 — Reliable RAG and search (P0/P1)

- [ ] Pin the embedding model and vector dimensions in environment/configuration. When changing models, re-embed all stored chunks before enabling retrieval against the new vectors.
- [ ] Add an embedding-version field to each document/chunk and reject or migrate mixed dimensions/models safely.
- [ ] Add clear ingestion states (`queued`, `processing`, `ready`, `failed`) and useful retry/error messages in the UI.
- [ ] Handle scanned PDFs and poor extraction explicitly. Add OCR only with limits and tests; do not silently report an empty extraction as success.
- [ ] Test chunk overlap, document ownership filters, selected-document filtering, no-match behavior, and the response when the requested answer is absent from the file.
- [ ] Add source metadata to retrieved chunks (document name, page/section where available) and show document references in answers. Keep web source URLs separate and clearly labeled.
- [ ] Make web search decisions robust: disclose when live search fails or is disabled instead of implying an answer was verified online.
- [ ] Apply prompt-injection defenses to uploaded files and webpages; treat retrieved content as untrusted data rather than instructions.

**Acceptance gate:** representative questions answer from the selected documents, unrelated users' chunks never appear, insufficient evidence produces an explicit limitation, and web/document references accurately identify their origin.

## Phase 3 — Reliability, cost, and operations (P1)

- [ ] Add request IDs, structured logs, error tracking, health/readiness endpoints, and monitoring for API latency, model failures, search errors, ingestion duration, and rate-limit events.
- [ ] Add global and per-user rate limits for chat, embeddings, upload, and authentication. Set maximum tokens, file size, chunk count, and retrieval-context size.
- [ ] Add provider timeouts, bounded retries with backoff for transient errors, and a documented fallback policy. Avoid retrying permanent 4xx errors blindly.
- [ ] Move long document ingestion to a background job/queue if request durations become unreliable; make jobs idempotent so retries don't duplicate chunks.
- [ ] Define budget alerts and usage metrics for NVIDIA, Tavily, and hosting. Track usage without logging raw user document content.
- [ ] Test Render restart/redeploy behavior and confirm user sessions, conversations, and uploaded-document metadata survive as intended.

**Acceptance gate:** transient provider errors are handled gracefully; rate limits and budget limits work; service health and major failures are observable.

## Phase 4 — Product trust and user experience (P1/P2)

- [ ] Add a real Privacy Policy, Terms, contact/support route, and a clear data deletion request process.
- [ ] Add answer feedback, copy response, retry/regenerate, and visible source/document references where supported.
- [ ] Improve accessibility: keyboard navigation, focus states, reduced-motion support, form labels, contrast checks, and responsive testing.
- [ ] Add empty/loading/error states for uploads, login, conversations, and web search failures.
- [ ] Add account deletion and document deletion tests, including cleanup of related chunks/embeddings.
- [ ] Test on small mobile screens, modern desktop browsers, and with slow networks.
- [ ] Verify analytics and Google Ads tracking against applicable consent/privacy requirements; collect only the events actually needed.

**Acceptance gate:** users can understand how their files are used, navigate the app with a keyboard, recover from common failures, and request deletion of their data.

## Phase 5 — Release process (P1)

- [ ] Create separate development/staging/production environment configurations and secrets.
- [ ] Run CI on every pull request: lint/typecheck, unit tests, API tests, build, dependency/security scan.
- [ ] Add end-to-end tests for signup/login, create/open/delete conversation, upload/select/delete file, document Q&A, general chat, and web-source display.
- [ ] Use a staging deployment with a safe test dataset before each production release.
- [ ] Keep a rollback plan and release notes; deploy gradually where hosting supports it.
- [ ] Rehearse incident handling and database restore before inviting real users.

## Suggested first sprint

1. Build and test the exact commit that will be deployed.
2. Complete auth and cross-user authorization tests.
3. Confirm embedding model/version migration and re-index strategy.
4. Add document/web source references and ingestion status/error states.
5. Add privacy/terms, deletion policy, upload safety limits, and monitoring.
6. Deploy to staging, run the end-to-end checklist, then release to a limited audience.

## Landing page content notes

- Avoid unsupported claims such as “100% accurate,” “fully private,” “enterprise-grade,” “unlimited,” or fabricated user/accuracy metrics.
- Be clear that AI outputs can be incorrect and that scanned or complex files may not extract perfectly.
- Publish a privacy policy and terms before directing public users to upload real documents.
- Replace the illustrative chat preview with a real, clearly interactive demo only if its behavior and data use are implemented and tested.
