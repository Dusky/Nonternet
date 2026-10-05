import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './queryClient';
import { App } from './App';
import { FeedbackProvider } from './components/feedback';
import { SiteProvider } from './hooks';
import { applyTheme, installThemeCss, rememberedTheme } from './theme';
import './fonts';
import './styles.css';

installThemeCss();
applyTheme(rememberedTheme(), { remember: false }); // until the site's default or the person's own choice is known

// The service worker (src/sw/sw.ts): offline opening and push notifications. Built files only; in development Vite
// serves the code and a worker would get in the way.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined); });
}


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SiteProvider>
          <FeedbackProvider>
            <App />
          </FeedbackProvider>
        </SiteProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
