// Pictures in posts and mail (docs/23, E6). In the text a picture is `![what it shows](image:i_…)`: the stored words stay
// plain and never name the site. The web draws it; terminals, mirrors and feeds get words and an address.
export const IMAGE_ID = /i_[0-9A-Z]{26}/;
export const IMAGE_MARKUP = /!\[([^\[\]\n]{0,200})\]\(image:(i_[0-9A-Z]{26})\)/g;
export const IMAGES_PER_POST = 4;
export const IMAGE_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_MAX_SIDE = 1600;
export const IMAGE_ALT_MAX = 200;

export const imageUrl = (id: string): string => `/api/v1/images/${id}`;

// The pictures a text uses, once each, in order.
export function imageIds(body: string): string[] {
  const seen: string[] = [];
  for (const m of body.matchAll(IMAGE_MARKUP)) if (!seen.includes(m[2]!)) seen.push(m[2]!);
  return seen;
}

// For places that cannot show a picture: "[picture: a red door] https://site/api/v1/images/i_…".
export function describeImages(body: string, baseUrl: string): string {
  return body.replace(IMAGE_MARKUP, (_m, alt: string, id: string) => `[picture: ${alt.trim() || 'no description'}] ${baseUrl.replace(/\/$/, '')}${imageUrl(id)}`);
}

export interface UploadedImage { id: string; width: number; height: number }
