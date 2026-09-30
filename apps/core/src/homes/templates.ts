// Starter pages (docs/07). Written for this project, so there is nothing to license. They use
// plain HTML and CSS in the style of the early web, and ask nothing of the person who picks one.
// No product name here: a template only knows the person's handle and title.
export interface Template { id: string; title: string; description: string; files: (v: { handle: string; title: string }) => Record<string, string> }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const BASE_CSS = (bg: string, fg: string, accent: string) => `/* Change anything here. This file styles every page. */
body { margin: 0; padding: 2rem 1rem; background: ${bg}; color: ${fg}; font: 18px/1.5 Georgia, "Times New Roman", serif; }
main { max-width: 40rem; margin: 0 auto; }
h1 { border-bottom: 3px double ${accent}; padding-bottom: .3rem; }
a { color: ${accent}; }
hr { border: 0; border-top: 2px dashed ${accent}; margin: 2rem 0; }
.small { font-size: .85rem; opacity: .8; }
`;

export const TEMPLATES: Template[] = [
  {
    id: 'blank', title: 'Blank page', description: 'A title and an empty page. Start from nothing.',
    files: ({ title }) => ({
      'index.html': `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${esc(title)}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <main>\n    <h1>${esc(title)}</h1>\n    <p>Write something here.</p>\n  </main>\n</body>\n</html>\n`,
      'style.css': BASE_CSS('#fffef8', '#222', '#1a4fa0'),
    }),
  },
  {
    id: 'about-me', title: 'About me', description: 'Who you are, what you like, and a list of links.',
    files: ({ handle, title }) => ({
      'index.html': `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${esc(title)}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <main>\n    <h1>Hi, I am ${esc(handle)}</h1>\n    <p>This is my corner of the web. I made it myself.</p>\n    <h2>Things I like</h2>\n    <ul>\n      <li>Making things</li>\n      <li>Old computers</li>\n      <li>Good music</li>\n    </ul>\n    <hr>\n    <h2>Links</h2>\n    <ul>\n      <li><a href="links.html">My favourite places</a></li>\n    </ul>\n    <p class="small">Last edited by hand.</p>\n  </main>\n</body>\n</html>\n`,
      'links.html': `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Links - ${esc(title)}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <main>\n    <h1>My favourite places</h1>\n    <ul>\n      <li>Add a link here.</li>\n    </ul>\n    <p><a href="index.html">Back home</a></p>\n  </main>\n</body>\n</html>\n`,
      'style.css': BASE_CSS('#f4f0e6', '#2b2118', '#a3341f'),
    }),
  },
  {
    id: 'fan-page', title: 'Fan page', description: 'A page about one thing you love, with a place for a picture and a list.',
    files: ({ handle, title }) => ({
      'index.html': `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${esc(title)}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <main>\n    <h1>${esc(title)}</h1>\n    <p><em>A fan page by ${esc(handle)}.</em></p>\n    <p>Say what you love about it and why it matters to you.</p>\n    <h2>The best parts</h2>\n    <ol>\n      <li>The first best thing</li>\n      <li>The second best thing</li>\n      <li>The third best thing</li>\n    </ol>\n    <hr>\n    <p class="small">Put a picture in your files and add it with an img tag.</p>\n  </main>\n</body>\n</html>\n`,
      'style.css': BASE_CSS('#101820', '#e8f1f2', '#f2b632'),
    }),
  },
];
export const templateById = (id: string): Template | undefined => TEMPLATES.find((t) => t.id === id);
