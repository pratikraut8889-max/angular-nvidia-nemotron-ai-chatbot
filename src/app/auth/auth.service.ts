import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  signup(name: string, email: string, password: string): Observable<{ user: AuthUser }> {
    return this.http.post<{ user: AuthUser }>('/api/auth/signup', {
      name,
      email,
      password,
    });
  }

  login(email: string, password: string): Observable<{ user: AuthUser, token: string }> {
    return this.http.post<{ user: AuthUser, token: string }>('/api/auth/login', { email, password });
  }

  currentUser(): Observable<{ user: AuthUser }> {
    const token = localStorage.getItem('token');
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}` 
    })
    return this.http.get<{ user: AuthUser }>('/api/auth/me', { headers});
  }

}
