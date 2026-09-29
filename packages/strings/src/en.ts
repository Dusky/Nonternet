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
  'email.verify.subject': 'Confirm your email for {site.name}',
  'email.verify.body':
    'Welcome to {site.name}, {handle}.\n\nConfirm your email address to finish setting up your account:\n{link}\n\nThis link works for 24 hours. If you did not sign up, you can ignore this message.',
  'error.generic': 'Something went wrong. The admins have been notified.',
} as const;

export type StringKey = keyof typeof en;
