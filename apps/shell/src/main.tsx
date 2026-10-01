import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api';
import { App } from './App';
import { FeedbackProvider } from './components/feedback';
import { SiteProvider } from './hooks';
import { applyTheme, installThemeCss, rememberedTheme } from './theme';
import './styles.css';

installThemeCss();
applyTheme(rememberedTheme(), { remember: false }); // until the site's default or the person's own choice is known

// One quiet retry for a failed load (a blip), but not for a refusal (4xx): asking again will not change the answer.
const retryOnce = (count: number, err: unknown) => count < 1 && !(err instanceof ApiError && err.status >= 400 && err.status < 500);
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: retryOnce, retryDelay: 800, refetchOnWindowFocus: false } } });

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
