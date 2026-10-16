import { MongoClient, type Db } from 'mongodb';

let client: MongoClient | undefined;
let database: Db | undefined;
let connection: Promise<void> | undefined;

export async function connectDatabase(): Promise<void> {
  const uri = process.env['MONGODB_URI']?.trim();
  if (!uri) {
    throw new Error('MONGODB_URI must be configured. Refusing to fall back to an implicit local database.');
  }

  const databaseName = process.env['MONGODB_DB_NAME']?.trim() || 'chatbotAPP';
  client ??= new MongoClient(uri, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
  });

  connection ??= client.connect().then(async () => {
    const db = client!.db(databaseName);
    database = db;
    await Promise.all([
      db.collection('users').createIndex({ email: 1 }, { unique: true }),
      db.collection('conversations').createIndex({ userId: 1, updatedAt: -1 }),
      db.collection('documents').createIndex({ userId: 1, createdAt: -1 }),
      db.collection('documentChunks').createIndex(
        { userId: 1, documentId: 1, chunkIndex: 1 },
        { unique: true },
      ),
      db.collection('rateLimits').createIndex({ key: 1 }, { unique: true }),
      db.collection('rateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
  }).catch((error: unknown) => {
    connection = undefined;
    database = undefined;
    throw error;
  });

  await connection;
  console.info(`Connected to MongoDB database "${databaseName}".`);
}

export function getDatabase(): Db {
  if (!database) {
    throw new Error('Database is not initialized. Call connectDatabase() before handling API requests.');
  }
  return database;
}
