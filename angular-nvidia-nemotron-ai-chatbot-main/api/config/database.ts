import { MongoClient } from 'mongodb';

const uri = process.env['MONGODB_URI'] || 'mongodb://localhost:27017';
const client = new MongoClient(uri);
const database = client.db('chatbotAPP');
let connection: Promise<void> | undefined;

export async function connectDatabase(): Promise<void> {
  connection ??= client.connect().then(async () => {
    await Promise.all([
      database.collection('users').createIndex({ email: 1 }, { unique: true }),
      database.collection('conversations').createIndex({ userId: 1, updatedAt: -1 }),
      database.collection('documents').createIndex({ userId: 1, createdAt: -1 }),
      database.collection('documentChunks').createIndex({ userId: 1, documentId: 1, chunkIndex: 1 }, { unique: true }),
      database.collection('rateLimits').createIndex({ key: 1 }, { unique: true }),
      database.collection('rateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
  });
  try {
    await connection;
    console.info('Connected to MongoDB.');
  } catch (error) {
    connection = undefined;
    console.error('Failed to connect to MongoDB:', error);
    throw error;
  }
}

export function getDatabase() {
  return database;
}