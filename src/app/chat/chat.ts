import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { ChatMessage, ChatService, ConversationSummary, DocumentSummary } from './chat.service';
import { MatIconModule } from '@angular/material/icon'
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu'
@Component({
  selector: 'app-chat',
  imports: [FormsModule, CommonModule, MatIconModule, MatButtonModule, MatMenuModule],
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
  readonly documents = signal<DocumentSummary[]>([]);
  readonly selectedDocumentIds = signal<string[]>([]);
  readonly documentsLoading = signal(false);
  readonly uploading = signal(false);
  readonly updatingDocumentSelection = signal(false);
  readonly deletingDocumentIds = signal<string[]>([]);
  readonly showSidebar = signal(false);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly auth = inject(AuthService);
  private readonly chat = inject(ChatService);
  private readonly router = inject(Router);
  readonly userProfile = signal<any>({})

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.pageLoading.set(false);
      return;
    }

    this.auth.currentUser().subscribe({
      next: (res: any) => {
        console.log("res", res)
        this.userProfile.set(res.user);
        this.loadDocuments();
        this.loadConversations();

      },
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
        this.selectedDocumentIds.set(conversation.documentIds ?? []);
        this.messages.set([]);
        this.showSidebar.set(false);
      },
      error: () => this.error.set('Could not create a conversation. Please try again.'),
    });
  }

  openConversation(id: string): void {
    this.error.set('');
    this.chat.getConversation(id).subscribe({
      next: ({ conversation }) => {
        this.activeConversationId.set(conversation.id);
        this.selectedDocumentIds.set(conversation.documentIds ?? []);
        this.messages.set(conversation.messages);
        this.showSidebar.set(false);

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
          this.selectedDocumentIds.set([]);
          this.messages.set([]);
        }
      },
      error: () => this.error.set('Could not delete this conversation. Please try again.'),
    });
  }

  sendMessage(): void {
    const content = this.inputText().trim();
    const conversationId = this.activeConversationId();
    if (!content || !conversationId || this.loading() || this.updatingDocumentSelection()) {
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
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('token');
    }
    void this.router.navigate(['/']);
  }

  uploadFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.uploading()) return;

    const allowed = /\.(pdf|docx|txt|csv|md)$/i.test(file.name);
    if (!allowed) {
      this.error.set('Choose a PDF, DOCX, TXT, CSV, or Markdown file.');
      input.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.error.set('Files must be 10 MiB or smaller.');
      input.value = '';
      return;
    }

    this.error.set('');
    this.uploading.set(true);
    this.chat.uploadDocument(file).subscribe({
      next: ({ document }) => {
        this.documents.update((items) => [document, ...items.filter((item) => item.id !== document.id)]);
        this.uploading.set(false);
        input.value = '';
        const conversationId = this.activeConversationId();
        if (conversationId && this.selectedDocumentIds().length < 5) {
          this.updateSelectedDocuments([...this.selectedDocumentIds(), document.id]);
        }
      },
      error: (response) => {
        this.uploading.set(false);
        input.value = '';
        this.error.set(response?.error?.error || response?.error?.message || 'Could not process this file. Check its format and try again.');
      },
    });
  }

  toggleDocument(documentId: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const current = this.selectedDocumentIds();
    const next = checked
      ? [...new Set([...current, documentId])]
      : current.filter((id) => id !== documentId);

    if (next.length > 5) {
      this.error.set('Select up to 5 documents per conversation.');
      return;
    }
    if (!this.activeConversationId()) {
      this.error.set('Create or open a conversation before attaching documents.');
      return;
    }
    this.updateSelectedDocuments(next);
  }

  deleteDocument(document: DocumentSummary): void {
    if (this.deletingDocumentIds().includes(document.id)) return;
    if (isPlatformBrowser(this.platformId) && !window.confirm(`Delete ${document.fileName}? Its chunks and embeddings will also be removed.`)) {
      return;
    }
    this.error.set('');
    this.deletingDocumentIds.update((ids) => [...ids, document.id]);
    this.chat.deleteDocument(document.id).subscribe({
      next: () => {
        this.documents.update((items) => items.filter((item) => item.id !== document.id));
        this.selectedDocumentIds.update((ids) => ids.filter((id) => id !== document.id));
        this.conversations.update((items) => items.map((item) => ({
          ...item,
          documentIds: (item.documentIds ?? []).filter((id) => id !== document.id),
        })));
        this.deletingDocumentIds.update((ids) => ids.filter((id) => id !== document.id));
      },
      error: () => {
        this.deletingDocumentIds.update((ids) => ids.filter((id) => id !== document.id));
        this.error.set('Could not delete this document. Please try again.');
      },
    });
  }

  private updateSelectedDocuments(documentIds: string[]): void {
    const conversationId = this.activeConversationId();
    if (!conversationId || this.updatingDocumentSelection()) return;
    this.updatingDocumentSelection.set(true);
    this.chat.setConversationDocuments(conversationId, documentIds).subscribe({
      next: ({ documentIds: savedIds }) => {
        this.selectedDocumentIds.set(savedIds);
        this.conversations.update((items) => items.map((item) =>
          item.id === conversationId ? { ...item, documentIds: savedIds } : item,
        ));
        this.updatingDocumentSelection.set(false);
        this.error.set('');
      },
      error: (response) => {
        this.updatingDocumentSelection.set(false);
        this.error.set(response?.error?.error || 'Could not update the documents attached to this conversation.');
      },
    });
  }

  private loadDocuments(): void {
    this.documentsLoading.set(true);
    this.chat.listDocuments().subscribe({
      next: ({ documents }) => {
        this.documents.set(documents);
        this.documentsLoading.set(false);
      },
      error: () => {
        this.documentsLoading.set(false);
      },
    });
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

  goToProfile(): void {
    this.showSidebar.set(false);
    void this.router.navigate(['/profile']);
  }
  goToSettings(): void {
    this.showSidebar.set(false);
    void this.router.navigate(['/settings']);
  }
}
