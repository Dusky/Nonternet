import { syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { EditorState } from '@codemirror/state';

// Studio editor extras (docs/07, docs/10): a lint for the common mistakes in a homepage, and completions for the
// site's own widgets. Both read the HTML syntax tree CodeMirror already keeps, so they cost nothing to start.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const LINKED = new Set(['src', 'href', 'action', 'data']);

export function lintHtml(state: EditorState): Diagnostic[] {
  const found: Diagnostic[] = [];
  const text = (from: number, to: number) => state.doc.sliceString(from, to);
  syntaxTree(state).iterate({
    enter: (node) => {
      const name = node.name;
      if (name === 'MismatchedCloseTag') {
        found.push({ from: node.from, to: node.to, severity: 'error', message: 'This closing tag does not match the one that is open. Check the order of your tags.' });
      }
      if (name === 'Element') {
        const open = node.node.firstChild;
        const last = node.node.lastChild;
        const tag = open?.getChild('TagName');
        if (open && tag && last?.name === 'MissingCloseTag' && !VOID.has(text(tag.from, tag.to).toLowerCase())) {
          found.push({ from: open.from, to: open.to, severity: 'warning', message: `<${text(tag.from, tag.to)}> is never closed. Add </${text(tag.from, tag.to)}> where it should end.` });
        }
      }
      if (name === 'OpenTag' || name === 'SelfClosingTag') {
        const tag = node.node.getChild('TagName');
        const tagName = tag ? text(tag.from, tag.to).toLowerCase() : '';
        const attrs = node.node.getChildren('Attribute');
        const attr = (n: string) => attrs.find((a) => {
          const an = a.getChild('AttributeName');
          return an && text(an.from, an.to).toLowerCase() === n;
        });
        if (tagName === 'img' && !attr('alt')) {
          found.push({ from: node.from, to: node.to, severity: 'warning', message: 'This picture has no alt text. Say what it shows, or use alt="" if it is only decoration, so people using a screen reader know.' });
        }
        for (const a of attrs) {
          const an = a.getChild('AttributeName');
          const value = a.getChild('AttributeValue') ?? a.getChild('UnquotedAttributeValue');
          if (!an || !value || !LINKED.has(text(an.from, an.to).toLowerCase())) continue;
          if (/^["']?http:\/\//i.test(text(value.from, value.to))) {
            found.push({ from: value.from, to: value.to, severity: 'info', message: 'This address starts with http://. Your page is served over https, so browsers may block it. Use https:// if the other site has it.' });
          }
        }
      }
    },
  });
  return found;
}

export const htmlLinter = linter((view) => lintHtml(view.state), { delay: 400 });

// The site's own embeds, offered as you type "<script" or a widget's name. The person's handle fills in, and the
// address comes from the site, so nothing here names the site or its domain.
export function widgetCompletions(origin: string, handle: string, names: readonly string[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[\w-]+/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    return {
      from: word.from,
      options: names.map((n) => ({
        label: `widget-${n}`,
        detail: 'site widget',
        type: 'text',
        apply: `<script src="${origin}/widgets/${n}.js" data-user="${handle}"></script>`,
      })),
      validFor: /^[\w-]*$/,
    };
  };
}
