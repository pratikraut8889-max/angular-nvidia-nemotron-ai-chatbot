# ConversaNemo.ai — Angular 21 SSR + Nemotron + RAG

ConversaNemo.ai is a single-server full-stack application: Angular 21 renders the frontend through SSR, while Express exposes the `/api` endpoints from the same Node process. MongoDB stores users, conversations, document metadata, text chunks, and embeddings.

## Features

- Angular 21 chat UI with conversation management.
- NVIDIA Nemotron chat model with a configured fallback model.
- Tavily web research for time-sensitive questions; general queries search the global web by default.
- Authenticated document upload for PDF, DOCX, TXT, CSV, and Markdown files (10 MiB maximum).
- Text extraction, overlapping text chunks, NVIDIA `nv-embedqa-e5-v5` embeddings, and top-k semantic retrieval (RAG).
- Per-conversation document selection (up to five files) persisted in MongoDB.
- Each retrieval is scoped to the authenticated user and to the documents selected for the current conversation.
- Document deletion removes associated chunks/embeddings and clears conversation references.
- Passwords are stored as salted scrypt hashes. Accounts from the previous Cryptr-based version are migrated after a successful login.

## Architecture

```text
Angular 21 UI (SSR)
       |
       v
Express API mounted under /api
       |
       +--> Auth + Conversations
       |
       +--> Document API
       |      |-- PDF text extraction (Ghostscript)
       |      |-- DOCX XML extraction
       |      |-- TXT / CSV / Markdown text
       |      |-- chunking with overlap
       |      |-- NVIDIA embeddings endpoint
       |      `-- MongoDB documents + chunks
       |
       `--> AI service
              |-- retrieve relevant selected-file chunks (RAG)
              |-- Tavily search when current information is needed
              `-- Nemotron / fallback LLM -> final answer
```

Uploaded binary files are processed in memory and are **not stored as downloadable files**. Extracted chunks and embeddings are stored in MongoDB for follow-up questions. The extracted text/chunks are sent to NVIDIA to create embeddings and, when used in a chat, retrieved chunks are included in the LLM context. Do not upload data you are not allowed to share with those providers.

## Local setup

Use a supported modern Node.js version (Node 22 or newer is recommended for the current Angular 21 and built-in `fetch` APIs). MongoDB is required. PDF extraction uses Ghostscript (`gs`); DOCX/TXT/CSV/Markdown processing uses Node APIs.

1. Install packages:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in real credentials.

   ```bash
   cp .env.example .env
   ```

   Required for the full-stack server:
   - `MONGODB_URI`: MongoDB connection string.
   - `JWT_SECRET`: random secret at least 32 characters long.
   - `NVIDIA_API_KEY`: used for Nemotron chat and embeddings.

   `TAVILY_API_KEY` is optional, but without it the chatbot cannot retrieve live web sources.

   To generate a JWT secret:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

3. Build and run the SSR server:

   ```bash
   npm run build
   npm run serve:ssr
   ```

   Open `http://localhost:4000`. The health endpoint is `http://localhost:4000/api/health`.

`ng serve` is useful for frontend-only work, but the integrated APIs require the full SSR/Express server and MongoDB connection.

## File upload and RAG

1. Choose **Upload** in the Knowledge files panel. The browser sends the file as a binary body with an `X-File-Name` header.
2. The API validates the extension and file signature where applicable, extracts text, splits it into overlapping chunks, and generates passage embeddings.
3. The metadata, extracted chunk text, and embeddings are saved in MongoDB. The original binary file is discarded after processing.
4. Select one or more documents in a conversation. The selected document IDs are validated against the logged-in user and saved on that conversation.
5. For each question, ConversaNemo.ai embeds the question using `input_type: query`, retrieves the most similar chunks only from the selected documents, and passes those excerpts to the LLM.

Limits: 10 MiB per file, up to 25 documents per account, up to five selected files per conversation, a bounded extracted-text size, and a bounded number of chunks per file. Scanned/image-only PDFs are not OCR'd yet and return a clear no-readable-text error.

### MongoDB vector search

For local development or small collections, the application uses a bounded cosine-similarity fallback over chunks from the selected documents. This is not the preferred strategy for large production collections.

For MongoDB Atlas, create a Vector Search index named `document_vector_index` on collection `documentChunks` with:

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 1024, "similarity": "cosine" },
    { "type": "filter", "path": "userId" },
    { "type": "filter", "path": "documentId" }
  ]
}
```

Then set:

```env
MONGODB_VECTOR_SEARCH_ENABLED=true
MONGODB_VECTOR_INDEX_NAME=document_vector_index
```

The query filter includes both the authenticated user's ObjectId and the selected document IDs. Keep these filter fields in the Vector Search index; without them, the application falls back to cosine scoring for correctness.

## Render deployment

Deploy as a **Web Service** (not a static site), because the application needs a Node/Express SSR process and API routes.

- Build command: `npm install && npm run build`
- Start command: `npm run serve:ssr`
- Add these environment variables in Render: `MONGODB_URI`, `JWT_SECRET`, `NVIDIA_API_KEY`, and optionally `TAVILY_API_KEY`, `MONGODB_VECTOR_SEARCH_ENABLED`, `MONGODB_VECTOR_INDEX_NAME`, and `NVIDIA_EMBEDDING_MODEL`.
- Ensure the runtime has Ghostscript available for PDF extraction. Render's native runtimes list Ghostscript among included utilities; if you change hosting/runtime, verify that `gs` exists.
- MongoDB must be reachable from the deployed service. Restrict database network access to the service where possible.

**JWT secret change:** changing `JWT_SECRET` invalidates existing bearer tokens, so users will need to log in again. Configure the secret before deploying the auth changes.

**Existing conversation data:** the previous code used `req.user.userId` in conversation routes, while its JWT contained only `id`. Records created under that mismatch may have a missing/null owner and will not automatically appear after this fix. Do not automatically assign orphaned records to a user; back up the database and review/migrate old records manually, because guessing ownership could expose one user's chat to another.

## Production hardening still recommended

This repository now has the end-to-end RAG path and ownership checks, but production readiness also depends on the deployment and operations around it. Before exposing it to untrusted/high-volume users:

- The current MongoDB-backed rate limits cover signup, login, chat, and document upload, and share counters across instances. For high-volume deployments, move counters to Redis or an API gateway and add per-user AI cost quotas.
- Move bearer tokens from `localStorage` to secure, `HttpOnly`, `Secure`, `SameSite` cookies with an appropriate CSRF strategy.
- Use a background worker/queue for large-file ingestion and retryable embedding batches; the current upload is synchronous and bounded.
- Enable MongoDB Atlas Vector Search for larger corpora, monitor slow queries, and configure backups/restore tests.
- Add malware scanning and OCR for scanned PDFs if those file types are required.
- Add end-to-end tests for cross-user isolation, upload limits, parser failures, deleted documents, and model-provider errors.
- Add application monitoring, request IDs, alerting, quotas/billing controls, and retention/deletion policy for user documents.
- Keep API keys only in environment secrets; never put them in Angular/browser code.

## Tests

```bash
npm test
npm run build
```

The current environment used to prepare this change did not have the project dependencies installed and could not reach the npm registry, so a complete Angular/TypeScript build could not be run here. Run `npm install`, then `npm run build` and the API integration tests in your own environment before merging or deploying.

## Useful references

- NVIDIA `nv-embedqa-e5-v5` inference API: https://docs.api.nvidia.com/nim/reference/nvidia-nv-embedqa-e5-v5-infer
- NVIDIA embedding model overview: https://docs.api.nvidia.com/nim/reference/nvidia-nv-embedqa-e5-v5
- Render native runtimes (verify Ghostscript availability for the selected runtime): https://render.com/docs/native-runtimes
