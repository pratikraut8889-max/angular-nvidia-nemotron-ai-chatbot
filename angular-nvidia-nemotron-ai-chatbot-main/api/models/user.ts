// create schema with mongodb 
import mongoose, { Schema, Document } from 'mongoose';

const userSchema = new Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

export interface IUser extends Document {
    name: string;
    email: string;
    passwordHash: string;
    createdAt: Date;
    updatedAt: Date;
}

const User = mongoose.model<IUser>('User', userSchema);

export default User;