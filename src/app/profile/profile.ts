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
import { AuthService, AuthUser } from '../auth/auth.service';

@Component({
  selector: 'app-profile',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Profile implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  readonly profile = signal<any>(null);
  readonly name = signal('');
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.loading.set(false);
      return;
    }

    this.auth.currentUser().subscribe({
      next: ({ user }) => {
        this.profile.set(user);
        this.name.set(user.name ?? '');
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        void this.router.navigate(['/login']);
      },
    });
  }

  saveProfile(): void {
    const name = this.name().trim();
    if (this.saving()) return;

    if (!name || name.length > 100) {
      this.error.set('Your name must contain between 1 and 100 characters.');
      this.success.set('');
      return;
    }

    this.error.set('');
    this.success.set('');
    this.saving.set(true);

    this.auth.updateProfile(name).subscribe({
      next: ({ user }) => {
        this.profile.set(user);
        this.name.set(user.name);
        this.success.set('Your profile has been updated.');
        this.saving.set(false);
      },
      error: (response) => {
        this.error.set(
          response?.error?.error || 'Could not update your profile. Please try again.',
        );
        this.saving.set(false);
      },
    });
  }
}