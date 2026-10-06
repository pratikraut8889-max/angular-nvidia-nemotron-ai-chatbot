import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { ChatMessage, ChatService, ConversationSummary } from './chat.service';

@Component({
  selector: 'app-chat',
  imports: [FormsModule, CommonModule],
  templateUrl: './chat.html',
  styleUrl: './chat.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Chat implements OnInit {
  readonly inputText = signal('');
  readonly messages = signal<ChatMessage[]>([]);
  readonly conversations = signal<ConversationSummary[]>([]);
  readonly activeConversationId = signal('');
  readonly loading = signal(false);
  readonly pageLoading = signal(true);
  readonly error = signal('');
  private readonly auth = inject(AuthService);
  private readonly chat = inject(ChatService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    this.auth.currentUser().subscribe({
      next: () => this.loadConversations(),
      error: () => {
        this.pageLoading.set(false);
        void this.router.navigate(['/login']);
      },
    });
  }

  createConversation(): void {
    if (this.loading()) {
      return;
    }
    this.error.set('');
    this.chat.createConversation().subscribe({
      next: ({ conversation }) => {
        this.conversations.update((items) => [conversation, ...items]);
        this.activeConversationId.set(conversation.id);
        this.messages.set([]);
      },
      error: () => this.error.set('Could not create a conversation. Please try again.'),
    });
  }

  openConversation(id: string): void {
    this.error.set('');
    this.chat.getConversation(id).subscribe({
      next: ({ conversation }) => {
        this.activeConversationId.set(conversation.id);
        this.messages.set(conversation.messages);
      },
      error: () => this.error.set('Could not load this conversation. Please try again.'),
    });
  }

  deleteConversation(id: string): void {
    this.chat.deleteConversation(id).subscribe({
      next: () => {
        this.conversations.update((items) => items.filter((item) => item.id !== id));
        if (this.activeConversationId() === id) {
          this.activeConversationId.set('');
          this.messages.set([]);
        }
      },
      error: () => this.error.set('Could not delete this conversation. Please try again.'),
    });
  }

  sendMessage(): void {
    const content = this.inputText().trim();
    const conversationId = this.activeConversationId();
    if (!content || !conversationId || this.loading()) {
      return;
    }

    this.inputText.set('');
    this.error.set('');
    this.loading.set(true);
    this.chat.sendMessage(conversationId, content).subscribe({
      next: ({ messages }) => {
        this.messages.update((current) => [...current, ...messages]);
        this.conversations.update((items) => {
          const current = items.find((item) => item.id === conversationId);
          if (!current) {
            return items;
          }
          const next = {
            ...current,
            title: messages[0]?.content.slice(0, 70) || current.title,
            updatedAt: new Date().toISOString(),
          };
          return [next, ...items.filter((item) => item.id !== conversationId)];
        });
        this.loading.set(false);
      },
      error: () => {
        this.inputText.set(content);
        this.error.set('The assistant could not reply. Your message was not saved; please retry.');
        this.loading.set(false);
      },
    });
  }

  sendFeedback(message: ChatMessage, rating: 'up' | 'down'): void {
    const conversationId = this.activeConversationId();
    if (!conversationId) {
      return;
    }
    this.chat.sendFeedback(conversationId, message.id, rating).subscribe({
      next: () => {
        this.messages.update((items) =>
          items.map((item) =>
            item.id === message.id ? { ...item, feedback: { rating } } : item,
          ),
        );
      },
      error: () => this.error.set('Could not save feedback. Please try again.'),
    });
  }

  logout(): void {
    localStorage.removeItem("token");
    this.router.navigate(['/login']);
  }

  private loadConversations(): void {
    this.chat.listConversations().subscribe({
      next: ({ conversations }) => {
        this.conversations.set(conversations);
        this.pageLoading.set(false);
        const first = conversations[0];
        if (first) {
          this.openConversation(first.id);
        }
      },
      error: () => {
        this.pageLoading.set(false);
        this.error.set('Could not load your conversations.');
      },
    });
  }
}
