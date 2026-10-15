import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  feedback?: { rating: 'up' | 'down'; comment?: string };
};

export type DocumentSummary = {
  id: string;
  fileName: string;
  extension: string;
  mimeType: string;
  size: number;
  chunkCount: number;
  createdAt: string;
};

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  documentIds?: string[];
};

export type Conversation = ConversationSummary & {
  messages: ChatMessage[];
};

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);

  private authHeaders(extra?: Record<string, string>): HttpHeaders {
    const token = typeof localStorage !== 'undefined'
      ? localStorage.getItem('token')
      : null;
    const headers: Record<string, string> = { ...extra };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return new HttpHeaders(headers);
  }

  listConversations(): Observable<{ conversations: ConversationSummary[] }> {
    return this.http.get<{ conversations: ConversationSummary[] }>(
      '/api/conversations',
      { headers: this.authHeaders() },
    );
  }

  createConversation(): Observable<{ conversation: ConversationSummary }> {
    return this.http.post<{ conversation: ConversationSummary }>(
      '/api/conversations',
      {},
      { headers: this.authHeaders() },
    );
  }

  getConversation(id: string): Observable<{ conversation: Conversation }> {
    return this.http.get<{ conversation: Conversation }>(
      `/api/conversations/${encodeURIComponent(id)}`,
      { headers: this.authHeaders() },
    );
  }

  deleteConversation(id: string): Observable<void> {
    return this.http.delete<void>(
      `/api/conversations/${encodeURIComponent(id)}`,
      { headers: this.authHeaders() },
    );
  }

  setConversationDocuments(
    conversationId: string,
    documentIds: string[],
  ): Observable<{ documentIds: string[]; updatedAt: string }> {
    return this.http.put<{ documentIds: string[]; updatedAt: string }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/documents`,
      { documentIds },
      { headers: this.authHeaders() },
    );
  }

  listDocuments(): Observable<{
    documents: DocumentSummary[];
    maxDocuments: number;
    maxFileSize: number;
  }> {
    return this.http.get<{
      documents: DocumentSummary[];
      maxDocuments: number;
      maxFileSize: number;
    }>('/api/documents', { headers: this.authHeaders() });
  }

  uploadDocument(file: File): Observable<{ document: DocumentSummary }> {
    return this.http.post<{ document: DocumentSummary }>(
      '/api/documents',
      file,
      {
        headers: this.authHeaders({
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
        }),
      },
    );
  }

  deleteDocument(id: string): Observable<void> {
    return this.http.delete<void>(
      `/api/documents/${encodeURIComponent(id)}`,
      { headers: this.authHeaders() },
    );
  }

  sendMessage(
    conversationId: string,
    content: string,
  ): Observable<{ messages: ChatMessage[]; updatedAt: string }> {
    return this.http.post<{ messages: ChatMessage[]; updatedAt: string }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      { content },
      { headers: this.authHeaders() },
    );
  }

  sendFeedback(
    conversationId: string,
    messageId: string,
    rating: 'up' | 'down',
  ): Observable<void> {
    return this.http.post<void>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/feedback`,
      { rating },
      { headers: this.authHeaders() },
    );
  }
}
