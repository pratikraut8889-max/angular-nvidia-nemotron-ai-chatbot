import { spawn } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { ObjectId, type Collection, type Document } from 'mongodb';
import { getDatabase } from '../config/database';

const RETIRED_EMBEDDING_MODEL = 'nvidia/nv-embedqa-e5-v5';
const DEFAULT_EMBEDDING_MODEL = 'nvidia/nemotron-3-embed-1b';
const EMBEDDING_URL = 'https://integrate.api.nvidia.com/v1/embeddings';
const MAX_TEXT_CHARACTERS = 150_000;
const MAX_CHUNKS_PER_DOCUMENT = 160;
const CHUNK_SIZE = 1_200;
const CHUNK_OVERLAP = 180;
const EMBEDDING_BATCH_SIZE = 12;
const MAX_RETRIEVED_CHUNKS = 8;
const MAX_CONTEXT_CHARACTERS = 12_000;
const VECTOR_DIMENSIONS = 2_048;

function getEmbeddingModel(): string {
  const configuredModel = process.env['NVIDIA_EMBEDDING_MODEL']?.trim();
  if (configuredModel === RETIRED_EMBEDDING_MODEL) {
    throw new Error(
      `NVIDIA_EMBEDDING_MODEL is set to retired model ${RETIRED_EMBEDDING_MODEL}. ` +
      `Update it to ${DEFAULT_EMBEDDING_MODEL} and re-upload/re-index existing documents.`,
    );
  }
  return configuredModel || DEFAULT_EMBEDDING_MODEL;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_USER = 25;
export const MAX_SELECTED_DOCUMENTS = 5;

export interface DocumentSummary {
  id: string;
  fileName: string;
  extension: string;
  mimeType: string;
  size: number;
  chunkCount: number;
  createdAt: Date;
}

interface ChunkRecord extends Document {
  _id: ObjectId;
  userId: ObjectId;
  documentId: ObjectId;
  fileName: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
  embeddingModel: string;
  createdAt: Date;
}

export class DocumentInputError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'DocumentInputError';
  }
}

function documents(): Collection<Document> {
  return getDatabase().collection('documents');
}

function chunks(): Collection<ChunkRecord> {
  return getDatabase().collection<ChunkRecord>('documentChunks');
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([\da-f]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

/** Extract word/document.xml from a DOCX ZIP without writing uploaded files to disk. */
function extractDocxXml(buffer: Buffer): string {
  const minimumEndRecord = Math.max(0, buffer.length - 65_557);
  let endRecord = -1;
  for (let offset = buffer.length - 22; offset >= minimumEndRecord; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endRecord = offset;
      break;
    }
  }
  if (endRecord < 0) {
    throw new DocumentInputError('This DOCX file is not a valid ZIP-based document.');
  }

  const entryCount = buffer.readUInt16LE(endRecord + 10);
  let directoryOffset = buffer.readUInt32LE(endRecord + 16);

  for (let entry = 0; entry < entryCount; entry += 1) {
    if (directoryOffset + 46 > buffer.length || buffer.readUInt32LE(directoryOffset) !== 0x02014b50) {
      throw new DocumentInputError('The DOCX file directory is invalid.');
    }

    const compressionMethod = buffer.readUInt16LE(directoryOffset + 10);
    const compressedSize = buffer.readUInt32LE(directoryOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(directoryOffset + 24);
    const fileNameLength = buffer.readUInt16LE(directoryOffset + 28);
    const extraLength = buffer.readUInt16LE(directoryOffset + 30);
    const commentLength = buffer.readUInt16LE(directoryOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(directoryOffset + 42);
    const entryName = buffer.toString(
      'utf8',
      directoryOffset + 46,
      directoryOffset + 46 + fileNameLength,
    );

    if (entryName === 'word/document.xml') {
      if (uncompressedSize > 5 * 1024 * 1024) {
        throw new DocumentInputError('The DOCX document content is too large to process.', 413);
      }
      if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new DocumentInputError('The DOCX document content is invalid.');
      }
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > buffer.length) {
        throw new DocumentInputError('The DOCX document content is truncated.');
      }

      const compressed = buffer.subarray(dataStart, dataEnd);
      let xml: Buffer;
      try {
        if (compressionMethod === 0) {
          xml = compressed;
        } else if (compressionMethod === 8) {
          xml = inflateRawSync(compressed, { maxOutputLength: 5 * 1024 * 1024 });
        } else {
          throw new DocumentInputError('This DOCX compression format is not supported.');
        }
      } catch (error) {
        if (error instanceof DocumentInputError) throw error;
        throw new DocumentInputError('Could not decompress the DOCX content.');
      }
      return xml.toString('utf8');
    }

    directoryOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new DocumentInputError('The DOCX file does not contain a readable document body.');
}

function extractDocxText(buffer: any): string {
  const xml = extractDocxXml(buffer);
  return xml
    .replace(/<w:tab\s*\/?\s*>/g, '\t')
    .replace(/<w:br\s*\/?\s*>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((line) => decodeXmlEntities(line).trim())
    .filter(Boolean)
    .join('\n');
}

function extractPdfText(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      reject(new DocumentInputError('The uploaded file is not a valid PDF.'));
      return;
    }

    // Ghostscript is available in Render's native runtimes. Input is piped over stdin;
    // no uploaded file is written to disk or made publicly accessible.
    const child = spawn('gs', [
      '-sDEVICE=txtwrite',
      '-sOutputFile=-',
      '-dSAFER',
      '-dBATCH',
      '-dNOPAUSE',
      '-q',
      '-',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finishError(new DocumentInputError('PDF processing timed out. Try a smaller or simpler PDF.', 422));
    }, 20_000);

    const finishError = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    child.stdout.on('data', (part: Buffer) => {
      outputBytes += part.length;
      if (outputBytes > MAX_TEXT_CHARACTERS * 4) {
        child.kill('SIGKILL');
        finishError(new DocumentInputError('The extracted PDF text is too large.', 413));
        return;
      }
      stdout.push(part);
    });

    child.stderr.on('data', (part: Buffer) => {
      if (stderrBytes < 8_192) {
        const available = 8_192 - stderrBytes;
        stderr.push(part.subarray(0, available));
        stderrBytes += Math.min(part.length, available);
      }
    });

    child.on('error', () => {
      finishError(new DocumentInputError('PDF extraction is unavailable on this server. Install Ghostscript or upload a DOCX, TXT, CSV, or Markdown file.', 503));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const details = Buffer.concat(stderr).toString('utf8').slice(0, 500);
        reject(new DocumentInputError(`Could not read this PDF. ${details ? 'Check that it is not encrypted or damaged.' : ''}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString('utf8'));
    });

    child.stdin.on('error', () => {
      // A timeout or output limit may close stdin while the parser is running.
    });
    child.stdin.end(buffer);
  });
}

export async function extractDocumentText(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const extension = fileName.toLowerCase().split('.').pop() || '';
  let text: string;

  switch (extension) {
    case 'pdf':
      text = await extractPdfText(buffer);
      break;
    case 'docx':
      if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
        throw new DocumentInputError('The uploaded file is not a valid DOCX document.');
      }
      text = extractDocxText(buffer);
      break;
    case 'txt':
    case 'csv':
    case 'md':
      if (buffer.includes(0)) {
        throw new DocumentInputError('Binary files are not supported as text documents.');
      }
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        throw new DocumentInputError('Text and CSV files must use UTF-8 encoding.');
      }
      break;
    default:
      throw new DocumentInputError('Supported file types are PDF, DOCX, TXT, CSV, and MD.');
  }

  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (!normalized) {
    throw new DocumentInputError('No readable text was found. Scanned/image-only PDFs need OCR, which is not enabled yet.', 422);
  }
  if (normalized.length > MAX_TEXT_CHARACTERS) {
    throw new DocumentInputError(`The extracted document is too long. Limit is ${MAX_TEXT_CHARACTERS.toLocaleString()} characters.`, 413);
  }
  return normalized;
}

export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length && chunks.length <= MAX_CHUNKS_PER_DOCUMENT) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n', end);
      const sentenceBreak = text.lastIndexOf('. ', end);
      const preferredBreak = Math.max(paragraphBreak, sentenceBreak);
      if (preferredBreak > start + Math.floor(CHUNK_SIZE * 0.6)) {
        end = preferredBreak + 1;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }

  if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
    throw new DocumentInputError('This document is too long to index in one request.', 413);
  }
  return chunks;
}

async function embedTexts(texts: string[], inputType: 'passage' | 'query'): Promise<number[][]> {
  const apiKey = process.env['NVIDIA_API_KEY'];
  if (!apiKey) {
    throw new Error('Missing NVIDIA_API_KEY. It is required for document embeddings.');
  }

  const embeddingModel = getEmbeddingModel();

  const response = await fetch(EMBEDDING_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: texts,
      model: embeddingModel,
      input_type: inputType,
      encoding_format: 'float',
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    console.error(`NVIDIA embedding request failed (${response.status}): ${detail}`);
    throw new Error(`Embedding service returned HTTP ${response.status}.`);
  }

  const payload = await response.json() as {
    data?: Array<{ index: number; embedding: number[] }>;
  };
  if (!Array.isArray(payload.data) || payload.data.length !== texts.length) {
    throw new Error('Embedding service returned an unexpected response.');
  }

  const sorted = [...payload.data].sort((a, b) => a.index - b.index);
  for (const item of sorted) {
    if (!Array.isArray(item.embedding) || item.embedding.length !== VECTOR_DIMENSIONS || item.embedding.some((v) => !Number.isFinite(v))) {
      throw new Error(`Embedding service must return ${VECTOR_DIMENSIONS}-dimension vectors.`);
    }
  }
  return sorted.map((item) => item.embedding);
}

async function embedInBatches(texts: string[], inputType: 'passage' | 'query'): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    vectors.push(...await embedTexts(batch, inputType));
  }
  return vectors;
}

function toSummary(document: any): DocumentSummary {
  return {
    id: document._id.toHexString(),
    fileName: document.fileName,
    extension: document.extension,
    mimeType: document.mimeType,
    size: document.size,
    chunkCount: document.chunkCount,
    createdAt: document.createdAt,
  };
}

export async function listUserDocuments(userId: ObjectId): Promise<DocumentSummary[]> {
  const result = await documents()
    .find({ userId })
    .project({ fileName: 1, extension: 1, mimeType: 1, size: 1, chunkCount: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .limit(MAX_DOCUMENTS_PER_USER)
    .toArray();
  return result.map(toSummary);
}

export async function ingestDocument(args: {
  userId: ObjectId;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<DocumentSummary> {
  const totalDocs = await documents().countDocuments({ userId: args.userId });
  if (totalDocs >= MAX_DOCUMENTS_PER_USER) {
    throw new DocumentInputError(`You can store up to ${MAX_DOCUMENTS_PER_USER} documents. Delete one before uploading another.`, 409);
  }
  if (!args.buffer.length || args.buffer.length > MAX_UPLOAD_BYTES) {
    throw new DocumentInputError('File must be between 1 byte and 10 MiB.', 413);
  }

  const extractedText = await extractDocumentText(args.buffer, args.fileName);
  const textChunks = chunkText(extractedText);
  const embeddingModel = getEmbeddingModel();
  const vectors = await embedInBatches(textChunks, 'passage');
  const now = new Date();
  const documentId = new ObjectId();
  const extension = args.fileName.toLowerCase().split('.').pop() || 'unknown';
  const metadata = {
    _id: documentId,
    userId: args.userId,
    fileName: args.fileName,
    extension,
    mimeType: args.mimeType || 'application/octet-stream',
    size: args.buffer.length,
    chunkCount: textChunks.length,
    extractedCharacters: extractedText.length,
    embeddingModel,
    createdAt: now,
  };

  await documents().insertOne(metadata);
  try {
    const records = textChunks.map((text, index): ChunkRecord => ({
      _id: new ObjectId(),
      userId: args.userId,
      documentId,
      fileName: args.fileName,
      chunkIndex: index,
      text,
      embedding: vectors[index],
      embeddingModel,
      createdAt: now,
    } as ChunkRecord));
    await chunks().insertMany(records, { ordered: true });
  } catch (error) {
    await Promise.all([
      chunks().deleteMany({ userId: args.userId, documentId }),
      documents().deleteOne({ _id: documentId, userId: args.userId }),
    ]);
    throw error;
  }

  return toSummary(metadata);
}

export async function deleteUserDocument(userId: ObjectId, documentId: ObjectId): Promise<boolean> {
  const existing = await documents().findOne({ _id: documentId, userId });
  if (!existing) return false;

  // Remove references first so a failed cleanup cannot leave a selected deleted file in a chat.
  await getDatabase().collection('conversations').updateMany(
    { userId, documentIds: documentId },
    { $pull: { documentIds: documentId } as any },
  );
  await chunks().deleteMany({ userId, documentId });
  await documents().deleteOne({ _id: documentId, userId });
  return true;
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

async function retrieveAtlasVectorSearch(
  userId: ObjectId,
  documentIds: ObjectId[],
  queryVector: number[],
): Promise<any[] | null> {
  if (process.env['MONGODB_VECTOR_SEARCH_ENABLED'] !== 'true') return null;
  const indexName = process.env['MONGODB_VECTOR_INDEX_NAME'] || 'document_vector_index';
  try {
    return await chunks().aggregate([
      {
        $vectorSearch: {
          index: indexName,
          path: 'embedding',
          queryVector,
          numCandidates: Math.max(MAX_RETRIEVED_CHUNKS * 20, 100),
          limit: MAX_RETRIEVED_CHUNKS,
          filter: {
            $and: [
              { userId: { $eq: userId } },
              { documentId: { $in: documentIds } },
              { embeddingModel: { $eq: getEmbeddingModel() } },
            ],
          },
        },
      },
      {
        $project: {
          fileName: 1,
          documentId: 1,
          chunkIndex: 1,
          text: 1,
          embeddingModel: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ]).toArray();
  } catch (error) {
    console.warn('Atlas Vector Search failed; using bounded cosine fallback:', error instanceof Error ? error.message : error);
    return null;
  }
}

/** Verify ownership, then retrieve only the most relevant chunks from the selected files. */
export async function buildDocumentContext(
  question: string,
  userId: ObjectId,
  requestedDocumentIds: ObjectId[],
): Promise<string> {
  if (requestedDocumentIds.length === 0) return '';
  if (requestedDocumentIds.length > MAX_SELECTED_DOCUMENTS) {
    throw new DocumentInputError(`Select no more than ${MAX_SELECTED_DOCUMENTS} documents.`, 400);
  }

  const uniqueIds = [...new Map(requestedDocumentIds.map((id) => [id.toHexString(), id])).values()];
  const owned = await documents()
    .find({ _id: { $in: uniqueIds }, userId })
    .project({ _id: 1, fileName: 1, embeddingModel: 1 })
    .toArray();
  if (owned.length !== uniqueIds.length) {
    throw new DocumentInputError('One or more selected documents are unavailable.', 404);
  }

  const activeEmbeddingModel = getEmbeddingModel();
  if (owned.some((document: any) => document['embeddingModel'] !== activeEmbeddingModel)) {
    throw new DocumentInputError(
      'One or more selected documents were indexed with an older embedding model. Delete and upload those documents again before asking questions.',
      409,
    );
  }

  const [queryVector] = await embedInBatches([question], 'query');
  let selected = await retrieveAtlasVectorSearch(userId, uniqueIds, queryVector);

  // Local MongoDB/development fallback; use an Atlas vector index for larger collections.
  if (!selected) {
    const candidates = await chunks()
      .find({ userId, documentId: { $in: uniqueIds } })
      .project({ fileName: 1, documentId: 1, chunkIndex: 1, text: 1, embedding: 1, embeddingModel: 1 })
      .limit(700)
      .toArray();
    selected = candidates
      .filter((chunk: any) => chunk['embeddingModel'] === activeEmbeddingModel && Array.isArray(chunk['embedding']) && chunk['embedding'].length === VECTOR_DIMENSIONS)
      .map((chunk: any) => ({ ...chunk, score: cosineSimilarity(queryVector, chunk['embedding']) }))
      .sort((left: any, right: any) => right.score - left.score)
      .slice(0, MAX_RETRIEVED_CHUNKS);
  }

  if (!selected?.length) return '';
  let remaining = MAX_CONTEXT_CHARACTERS;
  const contextParts: string[] = [];
  for (const item of selected) {
    if (remaining <= 0) break;
    const text = String(item.text || '').slice(0, remaining);
    contextParts.push(
      `[DOCUMENT: ${String(item.fileName || 'Uploaded document')}; CHUNK: ${Number(item.chunkIndex) + 1}; SIMILARITY: ${Number(item.score || 0).toFixed(3)}]\n${text}`,
    );
    remaining -= text.length;
  }

  return contextParts.join('\n\n--- Retrieved document section ---\n\n');
}
