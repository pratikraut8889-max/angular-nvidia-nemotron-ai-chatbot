import express from 'express';
import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database';
import { generateChatResponse } from '../services/ai.service';
import authMiddleware from '../middleware/auth';
import { mongoRateLimit } from '../middleware/rate-limit';
import { buildDocumentContext, DocumentInputError, MAX_SELECTED_DOCUMENTS } from '../services/document.service';
const router = express.Router();
const MAX_MESSAGE_LENGTH = 4000;
const MAX_CONTEXT_MESSAGES = 20;

function userIdFrom(req: any): ObjectId {
  return req.user.userId as ObjectId;
}

function conversationIdFrom(req: any): any {
  const id = req.params['conversationId'];
  return typeof id === 'string' && ObjectId.isValid(id) ? new ObjectId(id) : null;
}

function serializeMessage(message: any) {
  return {
    id: message._id.toHexString(),
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    ...(message.feedback ? { feedback: message.feedback } : {}),
  };
}



router.get('/', authMiddleware, async (req, res) => {
  const conversations = await getDatabase()
    .collection('conversations')
    .find({ userId: userIdFrom(req) })
    .project({ messages: 0 })
    .sort({ updatedAt: -1 })
    .limit(100)
    .toArray();
  res.json({
    conversations: conversations.map(({ _id, title, updatedAt, createdAt, documentIds }) => ({
      id: _id.toHexString(),
      title,
      updatedAt,
      createdAt,
      documentIds: Array.isArray(documentIds)
        ? documentIds.map((documentId: ObjectId) => documentId.toHexString())
        : [],
    })),
  });
});

router.post('/', authMiddleware, async (req, res) => {
  const title =
    typeof req.body?.title === 'string' && req.body.title.trim()
      ? req.body.title.trim().slice(0, 100)
      : 'New conversation';
  const now = new Date();
  const conversation: any = {
    userId: userIdFrom(req),
    title,
    messages: [],
    documentIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const result = await getDatabase()
    .collection('conversations')
    .insertOne(conversation);
  res.status(201).json({
    conversation: { id: result.insertedId.toHexString(), ...conversation },
  });
});

router.get('/:conversationId', authMiddleware, async (req, res) => {
  const id = conversationIdFrom(req);
  if (!id) {
    res.status(400).json({ error: 'Invalid conversation ID.' });
    return;
  }
  const conversation: any = await getDatabase()
    .collection('conversations')
    .findOne({ _id: id, userId: userIdFrom(req) });
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found.' });
    return;
  }
  res.json({
    conversation: {
      id: conversation._id.toHexString(),
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      documentIds: Array.isArray(conversation.documentIds)
        ? conversation.documentIds.map((documentId: ObjectId) => documentId.toHexString())
        : [],
      messages: conversation.messages.map(serializeMessage),
    },
  });
});

router.put('/:conversationId/documents', authMiddleware, async (req: any, res) => {
  const conversationId = conversationIdFrom(req);
  const userId = userIdFrom(req);
  const requested = req.body?.documentIds;

  if (!conversationId) {
    res.status(400).json({ error: 'Invalid conversation ID.' });
    return;
  }
  if (!Array.isArray(requested) || requested.length > MAX_SELECTED_DOCUMENTS ||
    requested.some((value: unknown) => typeof value !== 'string' || !ObjectId.isValid(value))) {
    res.status(400).json({ error: `Choose up to ${MAX_SELECTED_DOCUMENTS} valid documents.` });
    return;
  }

  const uniqueIds = [...new Set(requested as string[])];
  const objectIds = uniqueIds.map((value) => new ObjectId(value));
  const conversations: any = getDatabase().collection('conversations');
  const conversation = await conversations.findOne({ _id: conversationId, userId });
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found.' });
    return;
  }

  if (objectIds.length) {
    const ownedCount = await getDatabase().collection('documents').countDocuments({
      _id: { $in: objectIds },
      userId,
    });
    if (ownedCount !== objectIds.length) {
      res.status(404).json({ error: 'One or more documents were not found for this account.' });
      return;
    }
  }

  const updatedAt = new Date();
  await conversations.updateOne(
    { _id: conversationId, userId },
    { $set: { documentIds: objectIds, updatedAt } },
  );
  res.json({ documentIds: uniqueIds, updatedAt });
});

router.delete('/:conversationId', authMiddleware, async (req, res) => {
  const id = conversationIdFrom(req);
  if (!id) {
    res.status(400).json({ error: 'Invalid conversation ID.' });
    return;
  }
  const result = await getDatabase()
    .collection('conversations')
    .deleteOne({ _id: id, userId: userIdFrom(req) });
  if (result.deletedCount === 0) {
    res.status(404).json({ error: 'Conversation not found.' });
    return;
  }
  res.status(204).end();
});


router.post('/:conversationId/messages', authMiddleware, mongoRateLimit({ scope: 'chat-message', limit: 30, windowMs: 60 * 1000 }), async (req, res) => {
  const id = conversationIdFrom(req);
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!id) {
    res.status(400).json({ error: 'Invalid conversation ID.' });
    return;
  }
  if (!content || content.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: `Message must contain 1-${MAX_MESSAGE_LENGTH} characters.` });
    return;
  }

  const conversations: any = getDatabase().collection('conversations');
  const conversation = await conversations.findOne({ _id: id, userId: userIdFrom(req) });
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found.' });
    return;
  }


  const userMessage: any = {
    _id: new ObjectId(),
    role: 'user',
    content,
    createdAt: new Date(),
  };

  try {
    const context = [
      ...conversation.messages.slice(-(MAX_CONTEXT_MESSAGES - 1)),
      { role: userMessage.role, content: userMessage.content },
    ].map((message: any) => ({
      role: message.role as 'user' | 'assistant',
      content: String(message.content ?? ''),
    }));

    const selectedDocumentIds = Array.isArray(conversation.documentIds)
      ? conversation.documentIds.filter((value: unknown): value is ObjectId => value instanceof ObjectId)
      : [];
    const documentContext = selectedDocumentIds.length
      ? await buildDocumentContext(content, userIdFrom(req), selectedDocumentIds)
      : '';

    // Load preferences from the authenticated user's account.
    // Do not accept these settings from the request body.
    const account: any = await getDatabase()
      .collection('users')
      .findOne(
        { _id: userIdFrom(req) },
        { projection: { settings: 1 } },
      );

    const savedSettings = account?.settings ?? {};
    const answerStyle: 'concise' | 'balanced' | 'detailed' =
      savedSettings.answerStyle === 'concise' ||
        savedSettings.answerStyle === 'detailed' ||
        savedSettings.answerStyle === 'balanced'
        ? savedSettings.answerStyle
        : 'balanced';

    const webSearchEnabled =
      typeof savedSettings.webSearchEnabled === 'boolean'
        ? savedSettings.webSearchEnabled
        : true;

    const response = await generateChatResponse(context, {
      documentContext,
      answerStyle,
      webSearchEnabled,
    });
    const assistantMessage: any = {
      _id: new ObjectId(),
      role: 'assistant',
      content: response,
      createdAt: new Date(),
    };
    const updatedAt = new Date();
    await conversations.updateOne(
      { _id: id, userId: userIdFrom(req) },
      {
        $push: { messages: { $each: [userMessage, assistantMessage] } },
        $set: {
          updatedAt,
          ...(conversation.messages.length === 0
            ? { title: content.slice(0, 70) }
            : {}),
        },
      },
    );
    res.status(201).json({
      messages: [serializeMessage(userMessage), serializeMessage(assistantMessage)],
      updatedAt,
    });
  } catch (error) {
    console.error('Conversation message generation failed:', error instanceof Error ? error.message : error);
    if (error instanceof DocumentInputError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(502).json({ error: 'The assistant could not generate a response. Please check AI provider configuration and try again.' });
  }
});

router.post('/:conversationId/messages/:messageId/feedback', authMiddleware, async (req, res) => {
  const conversationId = conversationIdFrom(req);
  const messageId = req.params['messageId'];
  const rating = req.body?.rating;
  const comment = req.body?.comment;
  if (!conversationId || typeof messageId !== 'string' || !ObjectId.isValid(messageId)) {
    res.status(400).json({ error: 'Invalid conversation or message ID.' });
    return;
  }
  if (
    (rating !== 'up' && rating !== 'down') ||
    (comment !== undefined && (typeof comment !== 'string' || comment.length > 1000))
  ) {
    res.status(400).json({ error: 'Feedback must include a valid rating and an optional comment of at most 1000 characters.' });
    return;
  }

  const result = await getDatabase()
    .collection('conversations')
    .updateOne(
      {
        _id: conversationId,
        userId: userIdFrom(req),
        messages: { $elemMatch: { _id: new ObjectId(messageId), role: 'assistant' } },
      },
      {
        $set: {
          'messages.$.feedback': {
            rating,
            ...(typeof comment === 'string' && comment.trim() ? { comment: comment.trim() } : {}),
            updatedAt: new Date(),
          },
        },
      },
    );
  if (result.matchedCount === 0) {
    res.status(404).json({ error: 'Assistant message not found in this conversation.' });
    return;
  }
  res.status(200).json({ message: 'Thank you for your feedback.' });
});

export default router;
