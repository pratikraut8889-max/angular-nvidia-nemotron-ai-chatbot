import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService, AnswerStyle, UserSettings } from '../auth/auth.service';

@Component({
  selector: 'app-settings',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  readonly answerStyle = signal<AnswerStyle>('balanced');
  readonly webSearchEnabled = signal(true);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.loading.set(false);
      return;
    }

    this.auth.getSettings().subscribe({
      next: ({ settings }) => {
        this.applySettings(settings);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        void this.router.navigate(['/login']);
      },
    });
  }

  saveSettings(): void {
    if (this.saving()) return;

    const settings: UserSettings = {
      answerStyle: this.answerStyle(),
      webSearchEnabled: this.webSearchEnabled(),
    };

    this.error.set('');
    this.success.set('');
    this.saving.set(true);

    this.auth.updateSettings(settings).subscribe({
      next: ({ settings: savedSettings }) => {
        this.applySettings(savedSettings);
        this.success.set('Your preferences have been saved. They apply to new AI replies.');
        this.saving.set(false);
      },
      error: (response) => {
        this.error.set(
          response?.error?.error || 'Could not save your preferences. Please try again.',
        );
        this.saving.set(false);
      },
    });
  }

  private applySettings(settings: UserSettings): void {
    this.answerStyle.set(settings.answerStyle);
    this.webSearchEnabled.set(settings.webSearchEnabled);
  }
}