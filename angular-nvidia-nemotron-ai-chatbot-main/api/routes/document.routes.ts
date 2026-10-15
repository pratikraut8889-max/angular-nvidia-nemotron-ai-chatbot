import express from 'express';
import { basename, extname } from 'node:path';
import { ObjectId } from 'mongodb';
import authMiddleware from '../middleware/auth';
import { mongoRateLimit } from '../middleware/rate-limit';
import {
  DocumentInputError,
  MAX_DOCUMENTS_PER_USER,
  MAX_UPLOAD_BYTES,
  deleteUserDocument,
  ingestDocument,
  listUserDocuments,
} from '../services/document.service';

const router = express.Router();
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.csv', '.md']);

function safeFileName(raw: string): string {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new DocumentInputError('Invalid filename encoding.');
  }

  const normalized = basename(decoded.replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!normalized || normalized.length > 180) {
    throw new DocumentInputError('Filename must contain 1-180 characters.');
  }
  const extension = extname(normalized).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new DocumentInputError('Supported file types are PDF, DOCX, TXT, CSV, and MD.');
  }
  return normalized;
}

function contentTypeFor(extension: string, declared: string): string {
  const types: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.md': 'text/markdown',
  };
  // We store a safe inferred type rather than trusting the client's MIME header.
  return types[extension] || declared || 'application/octet-stream';
}

router.get('/', authMiddleware, async (req: any, res) => {
  const userId = req.user.userId as ObjectId;
  const documents = await listUserDocuments(userId);
  res.json({ documents, maxDocuments: MAX_DOCUMENTS_PER_USER, maxFileSize: MAX_UPLOAD_BYTES });
});

/**
 * Upload a binary body rather than multipart. This keeps the server dependency-free;
 * the filename is supplied in X-File-Name and the request is capped at 10 MiB.
 */
router.post(
  '/',
  authMiddleware,
  mongoRateLimit({ scope: 'document-upload', limit: 10, windowMs: 60 * 60 * 1000 }),
  express.raw({ type: '*/*', limit: MAX_UPLOAD_BYTES }),
  async (req: any, res) => {
    try {
      if (!Buffer.isBuffer(req.body)) {
        res.status(400).json({ error: 'Upload a file as a binary request body.' });
        return;
      }
      if (!req.body.length) {
        res.status(400).json({ error: 'The uploaded file is empty.' });
        return;
      }

      const fileNameHeader = req.header('x-file-name');
      if (!fileNameHeader) {
        res.status(400).json({ error: 'Missing X-File-Name header.' });
        return;
      }
      const fileName = safeFileName(fileNameHeader);
      const extension = extname(fileName).toLowerCase();
      const mimeType = contentTypeFor(extension, req.header('content-type') || '');

      // Reject mismatched file signatures for formats with a signature.
      if (extension === '.pdf' && req.body.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw new DocumentInputError('The file extension says PDF, but the file is not a valid PDF.');
      }
      if (extension === '.docx' && (req.body.length < 4 || req.body.readUInt32LE(0) !== 0x04034b50)) {
        throw new DocumentInputError('The file extension says DOCX, but the file is not a valid DOCX.');
      }

      const document = await ingestDocument({
        userId: req.user.userId as ObjectId,
        fileName,
        mimeType,
        buffer: req.body,
      });
      res.status(201).json({ document });
    } catch (error) {
      if (error instanceof DocumentInputError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      console.error('Document ingestion failed:', error instanceof Error ? error.message : error);
      res.status(502).json({ error: 'The file could not be processed. Verify the server AI configuration and try again.' });
    }
  },
);

router.delete('/:documentId', authMiddleware, async (req: any, res) => {
  const rawId = req.params['documentId'];
  if (typeof rawId !== 'string' || !ObjectId.isValid(rawId)) {
    res.status(400).json({ error: 'Invalid document ID.' });
    return;
  }

  const deleted = await deleteUserDocument(req.user.userId as ObjectId, new ObjectId(rawId));
  if (!deleted) {
    res.status(404).json({ error: 'Document not found.' });
    return;
  }
  res.status(204).end();
});

export default router;
