import { OpenAI } from 'openai';

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const DEFAULT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';

export async function generateChatResponse(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env['NVIDIA_API_KEY'];
  if (!apiKey) {
    throw new Error('NVIDIA_API_KEY is not configured.');
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://integrate.api.nvidia.com/v1',
  });
  const completion = await client.chat.completions.create({
    model: process.env['NVIDIA_MODEL'] || DEFAULT_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a helpful, clear, and conversational AI assistant.',
      },
      ...messages,
    ],
    temperature: 0.7,
    max_tokens: 2048,
  });
  const response = completion.choices[0]?.message?.content;

  if (typeof response !== 'string' || !response.trim()) {
    throw new Error('The model returned an empty response.');
  }

  return response.trim();
}
