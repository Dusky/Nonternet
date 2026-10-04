import { connectToHost, type Doc, type Host } from '@app/app-sdk';

// Todo: the first installable app (docs/10). A list kept on the person's account through the shell's bridge,
// one document per task in the "items" collection. Every change shows at once and is saved behind it; if the
// save fails, the change is put back and the person is told.

interface Item { text: string; done: boolean; created_at: string }
type Task = Doc<Item>;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $('app');
const form = $<HTMLFormElement>('add');
const input = $<HTMLInputElement>('new');
const list = $<HTMLUListElement>('list');
const empty = $('empty');
const foot = $('foot');
const left = $('left');
const clear = $<HTMLButtonElement>('clear');
const problem = $('problem');

let host: Host;
let tasks: Task[] = [];

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const byAge = (a: Task, b: Task) => a.data.created_at.localeCompare(b.data.created_at) || a.id.localeCompare(b.id);

function say(text: string | null) {
  problem.hidden = !text;
  problem.textContent = text ?? '';
}

// Saves behind the change already on screen; puts things back if it doesn't stick.
async function save(before: Task[], work: () => Promise<unknown>) {
  try { await work(); say(null); } catch {
    tasks = before;
    render();
    say('That didn’t save. Check your connection and try again.');
  }
}

function render(focusId?: string) {
  const open = tasks.filter((t) => !t.data.done).length;
  list.replaceChildren(...tasks.map(row));
  empty.hidden = tasks.length > 0;
  foot.hidden = tasks.length === 0;
  left.textContent = open === 1 ? '1 left' : `${open} left`;
  clear.disabled = tasks.every((t) => !t.data.done);
  void host?.setTitle(open ? `${open} left` : '');
  if (focusId) list.querySelector<HTMLElement>(`[data-id="${focusId}"] input[type=checkbox]`)?.focus();
}

function row(t: Task): HTMLLIElement {
  const li = document.createElement('li');
  li.dataset.id = t.id;
  li.className = t.data.done ? 'done' : '';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = t.data.done;
  box.id = `t-${t.id}`;
  box.addEventListener('change', () => toggle(t.id, box.checked));
  const label = document.createElement('label');
  label.htmlFor = box.id;
  label.textContent = t.data.text;
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'quiet';
  edit.textContent = 'Edit';
  edit.setAttribute('aria-label', `Edit “${t.data.text}”`);
  edit.addEventListener('click', () => startEdit(li, t));
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'quiet';
  del.textContent = 'Delete';
  del.setAttribute('aria-label', `Delete “${t.data.text}”`);
  del.addEventListener('click', () => remove(t.id));
  li.append(box, label, edit, del);
  return li;
}

function startEdit(li: HTMLLIElement, t: Task) {
  const field = document.createElement('input');
  field.value = t.data.text;
  field.maxLength = 500;
  field.className = 'edit';
  field.setAttribute('aria-label', 'Edit task');
  let finished = false;
  const finish = (keep: boolean) => {
    if (finished) return;
    finished = true;
    const text = field.value.trim();
    if (keep && text && text !== t.data.text) void rename(t.id, text); else render(t.id);
  };
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  field.addEventListener('blur', () => finish(true));
  li.replaceChildren(field);
  field.focus();
  field.select();
}

async function add(text: string) {
  const before = tasks;
  const t: Task = { id: newId(), data: { text, done: false, created_at: new Date().toISOString() }, updated_at: '' };
  tasks = [...tasks, t];
  render();
  await save(before, () => host.storage.put('items', t.id, t.data));
}

async function toggle(id: string, done: boolean) {
  const before = tasks;
  tasks = tasks.map((t) => (t.id === id ? { ...t, data: { ...t.data, done } } : t));
  render(id);
  const t = tasks.find((x) => x.id === id)!;
  await save(before, () => host.storage.put('items', id, t.data));
}

async function rename(id: string, text: string) {
  const before = tasks;
  tasks = tasks.map((t) => (t.id === id ? { ...t, data: { ...t.data, text } } : t));
  render(id);
  const t = tasks.find((x) => x.id === id)!;
  await save(before, () => host.storage.put('items', id, t.data));
}

// Deleting acts at once, with Undo in the note that says so.
async function remove(ids: string | string[]) {
  const gone = tasks.filter((t) => (Array.isArray(ids) ? ids.includes(t.id) : t.id === ids));
  if (!gone.length) return;
  const before = tasks;
  tasks = tasks.filter((t) => !gone.includes(t));
  render();
  input.focus();
  await save(before, () => Promise.all(gone.map((t) => host.storage.delete('items', t.id))));
  const undo = await host.toast(gone.length === 1 ? 'Task deleted.' : `${gone.length} tasks deleted.`, { undo: true });
  if (!undo) return;
  const now = tasks;
  tasks = [...tasks, ...gone].sort(byAge);
  render(gone[0]!.id);
  await save(now, () => Promise.all(gone.map((t) => host.storage.put('items', t.id, t.data))));
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  void add(text);
});
clear.addEventListener('click', () => void remove(tasks.filter((t) => t.data.done).map((t) => t.id)));

async function start() {
  try {
    host = await connectToHost();
    tasks = (await host.storage.list<Item>('items')).filter((t) => t.data && typeof t.data.text === 'string').sort(byAge);
    render();
  } catch {
    say('Todo couldn’t reach your list. Close it and open it again.');
  } finally {
    app.removeAttribute('aria-busy');
  }
  input.focus();
}
void start();
