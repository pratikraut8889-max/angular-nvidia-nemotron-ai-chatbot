import express from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import Cryptr from 'cryptr';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database';
import { getJwtSecret } from '../config/security';
import authMiddleware from '../middleware/auth';
import { mongoRateLimit } from '../middleware/rate-limit';

const router = express.Router();
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_PREFIX = 'scrypt';

// Used only to migrate accounts created by the previous reversible-Cryptr implementation.
const legacyCryptr = new Cryptr(process.env['CRYPTR_LEGACY_SECRET'] || 'SecretKEy');

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString('hex');
  return `${SCRYPT_PREFIX}$${salt}$${derivedKey}`;
}

function verifyScryptPassword(password: string, storedHash: string): boolean {
  const [prefix, salt, hash] = storedHash.split('$');
  if (prefix !== SCRYPT_PREFIX || !salt || !/^[\da-f]{32}$/i.test(salt) ||
    !hash || !/^[\da-f]{128}$/i.test(hash)) {
    return false;
  }
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function createToken(userId: ObjectId, email: string): string {
  return jwt.sign(
    { id: userId.toHexString(), email },
    getJwtSecret(),
    { expiresIn: '1h' },
  );
}

function publicUser(user: any) {
  return {
    id: user._id.toHexString(),
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}
type AnswerStyle = 'concise' | 'balanced' | 'detailed';
type UserSettings = {
  answerStyle: AnswerStyle;
  webSearchEnabled: boolean;
};
const DEFAULT_USER_SETTINGS: UserSettings = {
  answerStyle: 'balanced',
  webSearchEnabled: true,
};

function normalizeUserSettings(value: unknown): UserSettings {
  const settings = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  return {
    answerStyle:
      settings['answerStyle'] === 'concise' || settings['answerStyle'] === 'detailed'
        ? settings['answerStyle'] as AnswerStyle
        : 'balanced',
    webSearchEnabled:
      typeof settings['webSearchEnabled'] === 'boolean'
        ? settings['webSearchEnabled']
        : DEFAULT_USER_SETTINGS.webSearchEnabled,
  };
}



router.post('/signup', mongoRateLimit({ scope: 'auth-signup', limit: 5, windowMs: 60 * 60 * 1000 }), async (req, res) => {
  const { name, email, password } = req.body ?? {};
  if (
    typeof name !== 'string' || !name.trim() || name.trim().length > 100 ||
    typeof email !== 'string' || !/^[^\s@]@[^\s@]\.[^\s@]$/.test(email.trim()) ||
    typeof password !== 'string' || password.length < 8 || password.length > 128
  ) {
    res.status(400).json({ error: 'Enter a name, valid email, and password of 8-128 characters.' });
    return;
  }

  try {
    getJwtSecret(); // fail before creating an account if auth is misconfigured
    const normalizedEmail = email.trim().toLowerCase();
    const user = {
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: hashPassword(password),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await getDatabase().collection('users').insertOne(user);
    const userId = result.insertedId;
    res.status(201).json({
      user: publicUser({ _id: userId, ...user }),
      token: createToken(userId, normalizedEmail),
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }
    console.error('Signup failed:', error instanceof Error ? error.message : error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Could not create account. Check server configuration.' });
  }
});

router.post('/login', mongoRateLimit({ scope: 'auth-login', limit: 10, windowMs: 15 * 60 * 1000 }), async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || password.length > 128) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  try {
    getJwtSecret();
    const normalizedEmail = email.trim().toLowerCase();
    const users = getDatabase().collection('users');
    const user: any = await users.findOne({ email: normalizedEmail });
    if (!user || typeof user.passwordHash !== 'string') {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    let validPassword = false;
    let needsMigration = false;
    if (user.passwordHash.startsWith(`${SCRYPT_PREFIX}$`)) {
      validPassword = verifyScryptPassword(password, user.passwordHash);
    } else {
      // Backward compatibility for older accounts; successful logins are upgraded to scrypt.
      try {
        validPassword = legacyCryptr.decrypt(user.passwordHash) === password;
        needsMigration = validPassword;
      } catch {
        validPassword = false;
      }
    }

    if (!validPassword) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    if (needsMigration) {
      await users.updateOne(
        { _id: user._id },
        { $set: { passwordHash: hashPassword(password), updatedAt: new Date() } },
      );
    }

    res.status(200).json({
      user: publicUser(user),
      token: createToken(user._id as ObjectId, normalizedEmail),
    });
  } catch (error) {
    console.error('Login failed:', error instanceof Error ? error.message : error);
    res.status(500).json({ error: 'Could not log in. Check server configuration.' });
  }
});

router.get('/me', authMiddleware, async (req: any, res, next) => {
  try {
    const user = await getDatabase().collection('users').findOne(
      { _id: req.user.userId },
      { projection: { passwordHash: 0 } },
    );
    if (!user) {
      res.status(401).json({ error: 'Account not found.' });
      return;
    }
    res.json({
      user: {
        id: user._id.toHexString(),
        name: user['name'],
        email: user['email'],
        createdAt: user['createdAt'],
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/me/profile', authMiddleware, async (req: any, res, next) => {
  try {
    const name = req.body?.name;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
      res.status(400).json({ error: 'Name must contain between 1 and 100 characters.' });
      return;
    }

    const users = getDatabase().collection('users');
    const userId = req.user.userId;
    const result = await users.updateOne(
      { _id: userId },
      { $set: { name: name.trim(), updatedAt: new Date() } },
    );
    if (result.matchedCount === 0) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }

    const user: any = await users.findOne(
      { _id: userId },
      { projection: { passwordHash: 0 } },
    );
    res.json({
      user: {
        id: user._id.toHexString(),
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me/settings', authMiddleware, async (req: any, res, next) => {
  try {
    const user: any = await getDatabase().collection('users').findOne(
      { _id: req.user.userId },
      { projection: { settings: 1 } },
    );
    if (!user) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }
    res.json({ settings: normalizeUserSettings(user.settings) });
  } catch (error) {
    next(error);
  }
});

router.patch('/me/settings', authMiddleware, async (req: any, res, next) => {
  try {
    const answerStyle = req.body?.answerStyle;
    const webSearchEnabled = req.body?.webSearchEnabled;
    if (
      !['concise', 'balanced', 'detailed'].includes(answerStyle) ||
      typeof webSearchEnabled !== 'boolean'
    ) {
      res.status(400).json({ error: 'Provide a valid answerStyle and webSearchEnabled setting.' });
      return;
    }

    const settings: UserSettings = { answerStyle, webSearchEnabled };
    const result = await getDatabase().collection('users').updateOne(
      { _id: req.user.userId },
      { $set: { settings, updatedAt: new Date() } },
    );
    if (result.matchedCount === 0) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});



export default router;
