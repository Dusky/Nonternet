import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

// One query client for the app, shared by TanStack Query hooks and the TanStack DB collections (collections.ts).
// One quiet retry for a failed load (a blip), but not for a refusal (4xx): asking again will not change the answer.
const retryOnce = (count: number, err: unknown) => count < 1 && !(err instanceof ApiError && err.status >= 400 && err.status < 500);
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: retryOnce, retryDelay: 800, refetchOnWindowFocus: false } } });
