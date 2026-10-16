
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  createdAt?: string | Date;
};

export type AnswerStyle = 'concise' | 'balanced' | 'detailed';

export type UserSettings = {
  answerStyle: AnswerStyle;
  webSearchEnabled: boolean;
};

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient);

  private authHeaders(): HttpHeaders {
    const token =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem('token')
        : null;

    return token
      ? new HttpHeaders({
        Authorization: `Bearer ${token}`,
      })
      : new HttpHeaders();
  }

  signup(
    name: string,
    email: string,
    password: string,
  ): Observable<{ user: AuthUser; token: string }> {
    return this.http.post<{ user: AuthUser; token: string }>(
      '/api/auth/signup',
      {
        name,
        email,
        password,
      },
    );
  }

  login(
    email: string,
    password: string,
  ): Observable<{ user: AuthUser; token: string }> {
    return this.http.post<{ user: AuthUser; token: string }>(
      '/api/auth/login',
      {
        email,
        password,
      },
    );
  }

  currentUser(): Observable<{ user: AuthUser }> {
    return this.http.get<{ user: AuthUser }>('/api/auth/me', {
      headers: this.authHeaders(),
    });
  }

  updateProfile(name: string): Observable<{ user: AuthUser }> {
    return this.http.patch<{ user: AuthUser }>(
      '/api/auth/me/profile',
      { name },
      {
        headers: this.authHeaders(),
      },
    );
  }

  getSettings(): Observable<{ settings: UserSettings }> {
    return this.http.get<{ settings: UserSettings }>(
      '/api/auth/me/settings',
      {
        headers: this.authHeaders(),
      },
    );
  }

  updateSettings(
    settings: UserSettings,
  ): Observable<{ settings: UserSettings }> {
    return this.http.patch<{ settings: UserSettings }>(
      '/api/auth/me/settings',
      settings,
      {
        headers: this.authHeaders(),
      },
    );
  }
}
