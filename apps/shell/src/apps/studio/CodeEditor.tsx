import { useEffect, useRef, useState } from 'react';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { currentMode } from '../../theme';
import { basicSetup, EditorView } from 'codemirror';
import { EditorState, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { linter, lintGutter } from '@codemirror/lint';
import { abbreviationTracker, emmetCompletionSource } from '@emmetio/codemirror6-plugin';
import { htmlLinter, widgetCompletions } from './editorExtras';

// Every colour here is at least 7:1 against the editor's white background, so the code is readable
// in both site themes (the editor stays light in each).
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.controlKeyword], color: '#4a148c' },
  { tag: [t.string, t.special(t.string)], color: '#14501a' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#4a4a4a', fontStyle: 'italic' },
  { tag: [t.tagName, t.angleBracket], color: '#7a0000' },
  { tag: [t.attributeName, t.propertyName, t.variableName], color: '#0b3a66' },
  { tag: [t.attributeValue], color: '#14501a' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#6b2d00' },
  { tag: [t.className, t.typeName, t.function(t.variableName)], color: '#003f5c' },
  { tag: [t.meta, t.documentMeta, t.processingInstruction], color: '#3d3d3d' },
]);

// The same, for dark mode: every colour at least 7:1 against the dark editor background.
const highlightDark = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.controlKeyword], color: '#d7b4ff' },
  { tag: [t.string, t.special(t.string)], color: '#a5e8a0' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#b4b4b4', fontStyle: 'italic' },
  { tag: [t.tagName, t.angleBracket], color: '#ff9d9d' },
  { tag: [t.attributeName, t.propertyName, t.variableName], color: '#9cd0ff' },
  { tag: [t.attributeValue], color: '#a5e8a0' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#ffc58a' },
  { tag: [t.className, t.typeName, t.function(t.variableName)], color: '#8fe0ff' },
  { tag: [t.meta, t.documentMeta, t.processingInstruction], color: '#cccccc' },
]);
const darkTheme = EditorView.theme({
  '&': { backgroundColor: '#1b1b1f', color: '#ececec' },
  '.cm-content': { caretColor: '#ffffff' },
  '.cm-cursor': { borderLeftColor: '#ffffff' },
  '.cm-gutters': { backgroundColor: '#232328', color: '#b4b4b4', border: 'none' },
  '.cm-activeLine': { backgroundColor: '#2a2a31' },
  '.cm-activeLineGutter': { backgroundColor: '#2a2a31' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#3d4f7a' },
}, { dark: true });

export interface Widgets { origin: string; handle: string; names: readonly string[] }

// HTML gets tag and attribute completion (from CodeMirror), Emmet abbreviations ("ul>li*3" offered as an expansion), the
// site's own widgets, and a lint for the usual mistakes. Emmet is offered as a suggestion, not bound to Tab, so Tab
// still moves focus out of the editor.
// Emmet's suggestions read the state its tracker keeps, so the tracker is installed, but without its own keys (the
// last item it returns: Tab expands, Escape resets), so Tab is never taken from the keyboard.
const emmet = (): Extension => { const parts = abbreviationTracker(); return parts.slice(0, -1); };

const language = (path: string, widgets?: Widgets): Extension => {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'css') { const c = css(); return [c, emmet(), c.language.data.of({ autocomplete: emmetCompletionSource })]; }
  if (ext === 'js' || ext === 'mjs') return javascript();
  // JSON is checked as you type; Markdown gets its own mode; SVG and XML get the XML mode (not the HTML one, whose rules
  // about void elements and alt text are wrong for them).
  if (ext === 'json') return [json(), linter(jsonParseLinter()), lintGutter()];
  if (ext === 'md') return markdown();
  if (ext === 'svg' || ext === 'xml') return xml();
  if (ext === 'html' || ext === 'htm') {
    const h = html();
    return [
      h, emmet(), h.language.data.of({ autocomplete: emmetCompletionSource }),
      ...(widgets ? [h.language.data.of({ autocomplete: widgetCompletions(widgets.origin, widgets.handle, widgets.names) })] : []),
      htmlLinter, lintGutter(),
    ];
  }
  return [];
};

// The code editor (CodeMirror 6), loaded only when someone opens a file. It keeps its own text and
// reports each change; Ctrl+S or Cmd+S saves.
export default function CodeEditor({ path, value, label, onChange, onSave, widgets }: {
  path: string; value: string; label: string; onChange: (v: string) => void; onSave: () => void; widgets?: Widgets;
}) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef({ onChange, onSave });
  cb.current = { onChange, onSave };
  // Light or dark follows the interface (Settings → Appearance); a change starts the editor again with the text as it is.
  const [mode, setMode] = useState(currentMode);
  useEffect(() => { const f = () => setMode(currentMode()); window.addEventListener('ui:theme', f); return () => window.removeEventListener('ui:theme', f); }, []);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: latest.current,
        extensions: [
          basicSetup, mode === 'dark' ? [darkTheme, syntaxHighlighting(highlightDark)] : syntaxHighlighting(highlight), language(path, widgets), EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': label }),
          keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { cb.current.onSave(); return true; } }]),
          EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onChange(u.state.doc.toString()); }),
        ],
      }),
    });
    return () => view.destroy();
    // A different file gets a fresh editor. Typing must not rebuild it, so `value` is only the starting text.
  }, [path, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={host} className="code-editor" data-mode={mode} />;
}
