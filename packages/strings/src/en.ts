// All UI copy lives here. Voice: plain, friendly, direct (docs/00). Sentence case, digits for
// numbers, no exclamation marks. The site name and domains are placeholders filled in from config:
// {site.name}, {site.short_name}, {site.domain}, {site.homes_domain}. Other values use {name}.
export const en = {
  'landing.title': '{site.name}',
  'landing.tagline': 'Boards, rings and homepages, all under one login.',
  'landing.online': '{count} users online',
  'auth.login': 'Log in',
  'auth.signup': 'Sign up',
  'auth.welcomeBack': 'Welcome back, {handle}. {count} users online.',
  'board.empty': 'No posts yet.',
  'board.publicNotice': 'Posts on this board are public.',
  'error.generic': 'Something went wrong. The admins have been notified.',
} as const;

export type StringKey = keyof typeof en;
