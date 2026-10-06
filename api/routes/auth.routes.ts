import express from 'express';
import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database';
import Cryptr from 'cryptr';
import jwt from 'jsonwebtoken';
import authMiddleware from '../middleware/auth'
const cryptr = new Cryptr('SecretKEy');
const JWTSecretKey = 'gfdglfgdfhgj4hgjk';
const router = express.Router();



// SIGNUP ROUTE
router.post('/signup', async (req, res) => {
    const { name, email, password } = req.body ?? {};
    if (
        typeof name !== 'string' || !name.trim() || name.trim().length > 100 ||
        typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof password !== 'string' || password.length < 8 || password.length > 128
    ) {
        res.status(400).json({ error: 'Enter a name, valid email, and password of 8-128 characters.' });
        return;
    }

    try {
        const normalizedEmail = email.trim().toLowerCase();
        const users = getDatabase().collection('users');
        
        // FIX: Use cryptr.encrypt to securely save the plain-text password to the database
        const user = {
            name: name.trim(),
            email: normalizedEmail,
            passwordHash: cryptr.encrypt(password.toString()), 
            createdAt: new Date(),
        };

        // Uncommenting this so the database actually saves the user and generates the JWT token
        const result = await users.insertOne(user);
        const token = jwt.sign({ id: result.insertedId, email: user.email }, JWTSecretKey, { expiresIn: "1h" });
        
        // Exclude the password hash from the response for security
        const { passwordHash, ...userResponse } = user as any;
        userResponse._id = result.insertedId;

        res.status(201).json({ user: userResponse, token });
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
            res.status(409).json({ error: 'An account with this email already exists.' });
            return;
        }
        console.error('Signup failed:', error);
        res.status(500).json({ error: 'Could not create your account.' });
    }
});

// LOGIN ROUTE
router.post('/login', async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
    }

    try {
        const user: any = await getDatabase().collection('users').findOne({ email: email.trim().toLowerCase() });

        // FIX: Decrypt the stored passwordHash to compare it against the user's incoming plain text password
        if (!user || cryptr.decrypt(user.passwordHash) !== password) {
            res.status(401).json({ error: 'Invalid email or password.' });
            return;
        }

        const token = jwt.sign({ id: user._id, email: user.email }, JWTSecretKey, { expiresIn: "1h" });
        
        // Remove password hash before returning the user profile object
        delete user.passwordHash;

        res.status(200).json({ user, token });
    } catch (error) {
        console.error('Login failed:', error instanceof Error ? error.message : error);
        res.status(500).json({ error: 'Could not log in.' });
    }
});

// GET PROFILE ROUTE
router.get('/me', authMiddleware, async (_req: any, res: any, next: any) => {
    try {
        const users = getDatabase().collection('users');
        // FIX: Use new ObjectId() to properly fetch the user document by its MongoDB ID string
        const user: any = await users.findOne({ _id: new ObjectId(_req.user.id) });
        if (!user) {
            res.status(401).json({ error: 'Account not found.' });
            return;
        }
        
        // delete user.passwordHash;
        res.json({ user });
    } catch (error) {
        next(error);
    }
});

export default router;
