import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { authInterceptor, errorInterceptor } from './core/http/interceptors';
import { mockApiInterceptor } from './core/mock/mock-api.interceptor';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    // Thứ tự: gắn token → xử lý lỗi chung → mock API (khi bật).
    provideHttpClient(withFetch(), withInterceptors([authInterceptor, errorInterceptor, mockApiInterceptor])),
  ],
};
