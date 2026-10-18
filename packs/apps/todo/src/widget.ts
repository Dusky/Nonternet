import { connectToHost, type Doc } from '@app/app-sdk';

// Todo's home-panel widget (docs/10): the open tasks, oldest first, each one can be ticked off here. Adding and editing
// stay in the app itself.
interface Item { text: string; done: boolean; created_at: string }
const SHOWN = 5;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const list = $<HTMLUListElement>('list');

async function start() {
  try {
    const host = await connectToHost();
    let open: Doc<Item>[] = [];
    const render = () => {
      list.replaceChildren(...open.slice(0, SHOWN).map((t) => {
        const li = document.createElement('li');
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.addEventListener('change', () => {
          open = open.filter((x) => x.id !== t.id);
          render();
          void host.storage.put('items', t.id, { ...t.data, done: true }).catch(() => { $('problem').hidden = false; $('problem').textContent = 'That didn’t save.'; });
        });
        label.append(box, document.createTextNode(` ${t.data.text}`));
        li.append(label);
        return li;
      }));
      $('empty').hidden = open.length > 0;
      const rest = open.length - SHOWN;
      $('more').hidden = rest <= 0;
      $('more').textContent = rest === 1 ? 'And 1 more.' : `And ${rest} more.`;
    };
    open = (await host.storage.list<Item>('items'))
      .filter((t) => t.data && typeof t.data.text === 'string' && !t.data.done)
      .sort((a, b) => a.data.created_at.localeCompare(b.data.created_at));
    render();
  } catch {
    $('problem').hidden = false;
    $('problem').textContent = 'Couldn’t reach your list.';
  } finally {
    $('app').removeAttribute('aria-busy');
  }
}
void start();
