import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { email, form, FormField, FormRoot, required } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../auth.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, FormsModule, MatInputModule, MatFormFieldModule, MatButtonModule, FormField, FormRoot, RouterModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly error = signal('');

  loginModel = signal({
    email: '',
    password: '',
  });

  loginForm = form(this.loginModel, (path) => {
    required(path.email, { message: 'Email is required.' });
    email(path.email, { message: 'Enter a valid email.' });
    required(path.password, { message: 'Password is required.' });
  }, {

  });


  async submit() {
  const payload = this.loginModel();

  this.error.set('');

  try {
    const response = await firstValueFrom(
      this.auth.login(payload.email, payload.password)
    );
    console.log(response);
    localStorage.setItem('token', response.token)
    

    await this.router.navigate(['/chat']);
  } catch {
    this.error.set(
      'Login failed. Check your email and password, then try again.'
    );
  }
}
}