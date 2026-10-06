import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';

import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import {
  email,
  form,
  FormField,
  FormRoot,
  required,
} from '@angular/forms/signals';

import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { Router, RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../auth.service';

@Component({
  selector: 'app-signup',
  imports: [
    ReactiveFormsModule,
    FormsModule,
    MatInputModule,
    MatFormFieldModule,
    MatButtonModule,
    FormField,
    FormRoot,
    RouterModule,
  ],
  templateUrl: './signup.html',
  styleUrl: './signup.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Signup {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly error = signal('');
  readonly loading = signal(false);

  readonly signupModel = signal({
    name: '',
    email: '',
    password: '',
  });

  signupForm = form(this.signupModel, (path) => {
    required(path.name, {
      message: 'Name is required',
    });

    required(path.email, {
      message: 'Email is required',
    });

    email(path.email, {
      message: 'Email is not valid',
    });

    required(path.password, {
      message: 'Password is required',
    });
  });

  async submit() {
    if (this.signupForm().invalid()) {
      return;
    }

    const payload = this.signupModel();

    this.error.set('');
    this.loading.set(true);

    try {
      await firstValueFrom(
        this.auth.signup(
          payload.name,
          payload.email,
          payload.password,
        ),
      );

      await this.router.navigate(['/chat']);
    } catch {
      this.error.set(
        'Could not create the account. Check your details or try logging in.',
      );
    } finally {
      this.loading.set(false);
    }
  }
}
