import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { FeedbackProvider } from './components/feedback';
import { SiteProvider } from './hooks';
import { applyTheme, installThemeCss, rememberedTheme } from './theme';
import './styles.css';

installThemeCss();
applyTheme(rememberedTheme(), { remember: false }); // until the site's default or the person's own choice is known

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

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
