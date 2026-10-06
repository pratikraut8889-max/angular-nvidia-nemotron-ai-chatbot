import { Routes } from '@angular/router';

export const routes: Routes = [
    {
        path: 'signup',
        loadComponent: () => import('./auth/signup/signup').then(m => m.Signup)
    },
    {
        path: 'login',
        loadComponent: () => import('./auth/login/login').then(m => m.Login)
    },
    {
        path: 'chat',
        loadComponent: () => import('./chat/chat').then(m => m.Chat)
    },
  
    {
        path: '',
        loadComponent: () => import('./app').then(m => m.App)
    }
];
