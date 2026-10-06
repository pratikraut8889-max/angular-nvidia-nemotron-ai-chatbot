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

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = ConversationSummary & {
  messages: ChatMessage[];
};

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);


  listConversations(): Observable<{ conversations: ConversationSummary[] }> {
        const token = localStorage.getItem('token');

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}` 
    })
    return this.http.get<{ conversations: ConversationSummary[] }>('/api/conversations', {headers});
  }

  createConversation(): Observable<{ conversation: ConversationSummary }> {
     const token = localStorage.getItem('token');

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}` 
    })
    return this.http.post<{ conversation: ConversationSummary }>('/api/conversations', {}, {headers});
  }

  getConversation(id: string): Observable<{ conversation: Conversation }> {
     const token = localStorage.getItem('token');

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}` 
    })
    return this.http.get<{ conversation: Conversation }>(
      `/api/conversations/${encodeURIComponent(id)}`, {headers}
    );
  }

  deleteConversation(id: string): Observable<void> {
     const token = localStorage.getItem('token');

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}` 
    })
    return this.http.delete<void>(`/api/conversations/${encodeURIComponent(id)}`, {headers});
  }

  sendMessage(
    conversationId: string,
    content: string,
  ): Observable<{ messages: ChatMessage[]; updatedAt: string }> {
     const token = localStorage.getItem('token');

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}` 
    })
    return this.http.post<{ messages: ChatMessage[]; updatedAt: string }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      { content }, {headers}
    );
  }

  sendFeedback(
    conversationId: string,
    messageId: string,
    rating: 'up' | 'down',
  ): Observable<void> {
     const token = localStorage.getItem('token');

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}` 
    })
    return this.http.post<void>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/feedback`,
      { rating }, {headers}
    );
  }
}
