# NovaChat release checklist

## Configuration
- [ ] Set a unique `JWT_SECRET` with at least 32 random characters.
- [ ] Set `MONGODB_URI`, `NVIDIA_API_KEY`, and (if live search is enabled) `TAVILY_API_KEY` in the deployment dashboard.
- [ ] Keep provider keys out of Angular/browser bundles and Git history.
- [ ] Verify `gs` (Ghostscript) exists in the server runtime.

## Database / RAG
- [ ] Confirm the MongoDB indexes were created at application startup.
- [ ] For larger collections, create Atlas Vector Search index `document_vector_index` on `documentChunks`, including vector path `embedding` with 1,024 dimensions and filter fields `userId` and `documentId`.
- [ ] Enable `MONGODB_VECTOR_SEARCH_ENABLED=true` only after the Atlas index is ready.
- [ ] Test upload, question retrieval, document deletion, and conversation attachment persistence.
- [ ] Verify user A cannot list, select, retrieve, or delete user B's documents.
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
- [ ] Consider moving document ingestion to a background queue before handling high upload volume.
