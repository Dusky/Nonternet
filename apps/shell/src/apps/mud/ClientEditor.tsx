import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  HIGHLIGHT_COLOURS, MATCH_KINDS, mudClientSchema, mudAliasSchema, mudButtonSchema, mudKeySchema, mudTimerSchema, mudTriggerSchema,
  type MudAction, type MudAlias, type MudButton, type MudClient, type MudKey, type MudTimer, type MudTrigger,
} from '@app/shared';
import type { StringKey } from '@app/strings';
import { Alert, TextField } from '../../components/ui';
import { useT } from '../../hooks';
import { keyName, newId, validRegex } from './engine';
import { useMud } from './store';

// The MUD client's rules, kept on the account (docs/09). Each change is saved a moment after it is made. Rules only:
// every rule is a pattern and a few fixed actions, never code (decided 2026-10-02).

const TABS = ['aliases', 'triggers', 'timers', 'keys', 'buttons', 'variables', 'options', 'share'] as const;
type Tab = typeof TABS[number];

export default function ClientEditor({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('aliases');
  const saveError = useMud((s) => s.saveError);
  const id = useId();
  return (
    <section className="panel mud-editor" aria-labelledby={`${id}-h`}>
      <div className="panel-head">
        <h2 id={`${id}-h`}>{t('mud.ed.title')}</h2>
        <button type="button" className="btn btn-quiet" onClick={onClose}>{t('chat.close')}</button>
      </div>
      <p className="hint">{t('mud.ed.intro')}</p>
      {saveError && <Alert kind="error">{t('mud.ed.saveFailed')}</Alert>}
      <div className="tabs" role="tablist" aria-label={t('mud.ed.title')}>
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" id={`${id}-${k}`} aria-selected={tab === k} aria-controls={`${id}-panel`} className={tab === k ? 'is-active' : undefined} onClick={() => setTab(k)}>
            {t(`mud.ed.tab.${k}` as StringKey)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} className="mud-editor-body">
        {tab === 'aliases' && <Aliases />}
        {tab === 'triggers' && <Triggers />}
        {tab === 'timers' && <Timers />}
        {tab === 'keys' && <Keys />}
        {tab === 'buttons' && <Buttons />}
        {tab === 'variables' && <Variables />}
        {tab === 'options' && <Options />}
        {tab === 'share' && <Share />}
      </div>
    </section>
  );
}

// Reads and changes one list of the settings.
function useList<K extends 'aliases' | 'triggers' | 'timers' | 'keys' | 'buttons'>(key: K) {
  const settings = useMud((s) => s.settings);
  const save = useMud((s) => s.save);
  type Item = MudClient[K][number];
  const items = settings[key] as Item[];
  const put = (next: Item[]) => save({ ...useMud.getState().settings, [key]: next });
  return {
    items,
    upsert: (it: Item) => put(items.some((x) => x.id === it.id) ? items.map((x) => (x.id === it.id ? it : x)) : [...items, it]),
    remove: (id: string) => put(items.filter((x) => x.id !== id)),
    toggle: (id: string) => put(items.map((x) => (x.id === id && 'enabled' in x ? { ...x, enabled: !x.enabled } : x))),
    setAll: put,
  };
}

// A list of rules with edit and delete, and a form for a new one or the one being edited.
function RuleList<T extends { id: string; enabled?: boolean }>({ items, describe, form, onRemove, onToggle, empty, max }: {
  items: T[]; describe: (it: T) => ReactNode; form: (it: T | null, done: () => void) => ReactNode;
  onRemove: (id: string) => void; onToggle?: (id: string) => void; empty: string; max: number;
}) {
  const t = useT();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const done = () => setEditing(null);
  return (
    <>
      {items.length === 0 ? <p className="hint">{empty}</p> : (
        <ul className="plain mud-rules">
          {items.map((it) => (
            <li key={it.id} className={it.enabled === false ? 'is-off' : undefined}>
              {editing === it.id ? form(it, done) : (
                <>
                  <div className="mud-rule-text">{describe(it)}</div>
                  <div className="mud-rule-actions">
                    {onToggle && (
                      <label className="check switch"><input type="checkbox" role="switch" checked={it.enabled !== false} onChange={() => onToggle(it.id)} />{t('mud.ed.on')}</label>
                    )}
                    <button type="button" className="btn btn-quiet" onClick={() => setEditing(it.id)}>{t('mud.ed.edit')}</button>
                    <button type="button" className="btn btn-quiet" onClick={() => onRemove(it.id)}>{t('mud.ed.delete')}</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing === 'new' ? form(null, done) : items.length < max && <button type="button" className="btn" onClick={() => setEditing('new')}>{t('mud.ed.add')}</button>}
    </>
  );
}

function Select<V extends string>({ label, value, options, onChange, names }: { label: string; value: V; options: readonly V[]; onChange: (v: V) => void; names: (v: V) => string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as V)}>{options.map((o) => <option key={o} value={o}>{names(o)}</option>)}</select>
    </div>
  );
}

function FormShell({ onSubmit, onCancel, error, children }: { onSubmit: () => void; onCancel: () => void; error: string | null; children: ReactNode }) {
  const t = useT();
  return (
    <form className="mud-rule-form" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(); }}>
      {children}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="toolbar">
        <button type="submit" className="btn btn-primary">{t('mud.ed.save')}</button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="check switch"><input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

const matchName = (t: ReturnType<typeof useT>) => (m: string) => t(`mud.ed.match.${m}` as StringKey);

// ---------------------------------------------------------------- aliases

function Aliases() {
  const t = useT();
  const l = useList('aliases');
  return (
    <>
      <p className="hint">{t('mud.ed.aliasesHint')}</p>
      <Groups kind="aliases" />
      <RuleList items={l.items} max={200} empty={t('mud.ed.none')} onRemove={l.remove} onToggle={l.toggle}
        describe={(a) => <><code>{a.pattern}</code> <span className="hint">({matchName(t)(a.match)})</span> → <code>{a.send}</code>{a.group && <span className="badge">{a.group}</span>}</>}
        form={(a, done) => <AliasForm alias={a} done={(v) => { if (v) l.upsert(v); done(); }} />} />
    </>
  );
}

function AliasForm({ alias, done }: { alias: MudAlias | null; done: (v: MudAlias | null) => void }) {
  const t = useT();
  const [v, setV] = useState<MudAlias>(alias ?? { id: newId(), pattern: '', match: 'start', send: '', group: '', enabled: true });
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (v.match === 'regex' && !validRegex(v.pattern)) return setError(t('mud.ed.badRegex'));
    const r = mudAliasSchema.safeParse(v);
    if (!r.success || !v.send.trim()) return setError(t('mud.ed.invalid'));
    done(r.data);
  };
  return (
    <FormShell onSubmit={submit} onCancel={() => done(null)} error={error}>
      <TextField label={t('mud.ed.typed')} value={v.pattern} onChange={(p) => setV({ ...v, pattern: p })} maxLength={200} required />
      <Select label={t('mud.ed.matchLabel')} value={v.match} options={['start', 'exact', 'regex'] as const} onChange={(m) => setV({ ...v, match: m })} names={matchName(t)} />
      <TextField label={t('mud.ed.sends')} hint={t('mud.ed.sendsHint')} value={v.send} onChange={(s) => setV({ ...v, send: s })} maxLength={1000} required />
      <TextField label={t('mud.ed.group')} hint={t('mud.ed.groupHint')} value={v.group} onChange={(g) => setV({ ...v, group: g })} maxLength={30} />
    </FormShell>
  );
}

// Turning a whole group of rules on or off at once.
function Groups({ kind }: { kind: 'aliases' | 'triggers' | 'timers' }) {
  const t = useT();
  const l = useList(kind);
  const groups = [...new Set(l.items.map((x) => x.group).filter(Boolean))];
  if (!groups.length) return null;
  return (
    <fieldset className="mud-groups">
      <legend>{t('mud.ed.groups')}</legend>
      {groups.map((g) => {
        const on = l.items.some((x) => x.group === g && x.enabled);
        return <Check key={g} label={g} checked={on} onChange={(v) => l.setAll(l.items.map((x) => (x.group === g ? { ...x, enabled: v } : x)) as never)} />;
      })}
    </fieldset>
  );
}

// ---------------------------------------------------------------- triggers

function describeAction(t: ReturnType<typeof useT>, a: MudAction): string {
  switch (a.type) {
    case 'send': return t('mud.ed.act.sendText', { text: a.text });
    case 'highlight': return t('mud.ed.act.highlightText', { colour: t(`mud.ed.colour.${a.colour}` as StringKey) });
    case 'capture': return t('mud.ed.act.captureText', { window: a.window });
    case 'set': return t('mud.ed.act.setText', { name: a.name, value: a.value });
    default: return t(`mud.ed.act.${a.type}` as StringKey);
  }
}

function Triggers() {
  const t = useT();
  const l = useList('triggers');
  return (
    <>
      <p className="hint">{t('mud.ed.triggersHint')}</p>
      <Groups kind="triggers" />
      <RuleList items={l.items} max={200} empty={t('mud.ed.none')} onRemove={l.remove} onToggle={l.toggle}
        describe={(tr) => <><code>{tr.pattern}</code> <span className="hint">({matchName(t)(tr.match)})</span> → {tr.actions.map((a) => describeAction(t, a)).join(', ')}{tr.group && <span className="badge">{tr.group}</span>}</>}
        form={(tr, done) => <TriggerForm trigger={tr} done={(v) => { if (v) l.upsert(v); done(); }} />} />
    </>
  );
}

const ACTION_TYPES = ['send', 'highlight', 'gag', 'capture', 'beep', 'notify', 'set'] as const;
const blankAction = (type: MudAction['type']): MudAction => {
  switch (type) {
    case 'send': return { type, text: '' };
    case 'highlight': return { type, colour: 'yellow', line: false };
    case 'capture': return { type, window: 'Chat' };
    case 'set': return { type, name: 'target', value: '$1' };
    default: return { type } as MudAction;
  }
};

function TriggerForm({ trigger, done }: { trigger: MudTrigger | null; done: (v: MudTrigger | null) => void }) {
  const t = useT();
  const [v, setV] = useState<MudTrigger>(trigger ?? { id: newId(), pattern: '', match: 'contains', actions: [{ type: 'highlight', colour: 'yellow', line: false }], group: '', enabled: true });
  const [error, setError] = useState<string | null>(null);
  const setAction = (i: number, a: MudAction) => setV({ ...v, actions: v.actions.map((x, j) => (j === i ? a : x)) });
  const submit = () => {
    if (v.match === 'regex' && !validRegex(v.pattern)) return setError(t('mud.ed.badRegex'));
    const r = mudTriggerSchema.safeParse(v);
    if (!r.success) return setError(t('mud.ed.invalid'));
    done(r.data);
  };
  return (
    <FormShell onSubmit={submit} onCancel={() => done(null)} error={error}>
      <TextField label={t('mud.ed.when')} value={v.pattern} onChange={(p) => setV({ ...v, pattern: p })} maxLength={300} required />
      <Select label={t('mud.ed.matchLabel')} value={v.match} options={MATCH_KINDS} onChange={(m) => setV({ ...v, match: m })} names={matchName(t)} />
      <fieldset className="mud-actions">
        <legend>{t('mud.ed.then')}</legend>
        {v.actions.map((a, i) => (
          <div key={i} className="mud-action">
            <Select label={t('mud.ed.action', { n: i + 1 })} value={a.type} options={ACTION_TYPES} onChange={(ty) => setAction(i, blankAction(ty))} names={(x) => t(`mud.ed.act.${x}` as StringKey)} />
            {a.type === 'send' && <TextField label={t('mud.ed.sends')} hint={t('mud.ed.sendsTriggerHint')} value={a.text} onChange={(x) => setAction(i, { ...a, text: x })} maxLength={1000} />}
            {a.type === 'highlight' && <>
              <Select label={t('mud.ed.colour')} value={a.colour} options={HIGHLIGHT_COLOURS} onChange={(c) => setAction(i, { ...a, colour: c })} names={(c) => t(`mud.ed.colour.${c}` as StringKey)} />
              <Check label={t('mud.ed.wholeLine')} checked={a.line} onChange={(x) => setAction(i, { ...a, line: x })} />
            </>}
            {a.type === 'capture' && <TextField label={t('mud.ed.window')} value={a.window} onChange={(x) => setAction(i, { ...a, window: x })} maxLength={30} />}
            {a.type === 'set' && <>
              <TextField label={t('mud.ed.varName')} value={a.name} onChange={(x) => setAction(i, { ...a, name: x })} maxLength={31} />
              <TextField label={t('mud.ed.varValue')} value={a.value} onChange={(x) => setAction(i, { ...a, value: x })} maxLength={200} />
            </>}
            {v.actions.length > 1 && <button type="button" className="btn btn-quiet" onClick={() => setV({ ...v, actions: v.actions.filter((_, j) => j !== i) })}>{t('mud.ed.removeAction')}</button>}
          </div>
        ))}
        {v.actions.length < 8 && <button type="button" className="btn btn-quiet" onClick={() => setV({ ...v, actions: [...v.actions, blankAction('send')] })}>{t('mud.ed.addAction')}</button>}
      </fieldset>
      <TextField label={t('mud.ed.group')} hint={t('mud.ed.groupHint')} value={v.group} onChange={(g) => setV({ ...v, group: g })} maxLength={30} />
    </FormShell>
  );
}

// ---------------------------------------------------------------- timers, keys, buttons

function Timers() {
  const t = useT();
  const l = useList('timers');
  return (
    <>
      <p className="hint">{t('mud.ed.timersHint')}</p>
      <RuleList items={l.items} max={20} empty={t('mud.ed.none')} onRemove={l.remove} onToggle={l.toggle}
        describe={(x) => <>{x.label && <strong>{x.label}: </strong>}{t('mud.ed.every', { count: x.every })} → <code>{x.send}</code></>}
        form={(x, done) => <TimerForm timer={x} done={(v) => { if (v) l.upsert(v); done(); }} />} />
    </>
  );
}

function TimerForm({ timer, done }: { timer: MudTimer | null; done: (v: MudTimer | null) => void }) {
  const t = useT();
  const [v, setV] = useState<MudTimer>(timer ?? { id: newId(), label: '', every: 60, send: '', group: '', enabled: false });
  const [error, setError] = useState<string | null>(null);
  const submit = () => { const r = mudTimerSchema.safeParse(v); if (!r.success || !v.send.trim()) return setError(t('mud.ed.invalid')); done(r.data); };
  return (
    <FormShell onSubmit={submit} onCancel={() => done(null)} error={error}>
      <TextField label={t('mud.ed.label')} value={v.label} onChange={(x) => setV({ ...v, label: x })} maxLength={40} />
      <TextField label={t('mud.ed.seconds')} type="number" min={1} max={3600} value={String(v.every)} onChange={(x) => setV({ ...v, every: Number(x) || 0 })} />
      <TextField label={t('mud.ed.sends')} value={v.send} onChange={(x) => setV({ ...v, send: x })} maxLength={1000} required />
    </FormShell>
  );
}

function Keys() {
  const t = useT();
  const l = useList('keys');
  const numpad = useMud((s) => s.settings.options.numpad);
  return (
    <>
      <p className="hint">{t('mud.ed.keysHint')}{numpad ? ` ${t('mud.ed.keysNumpad')}` : ''}</p>
      <RuleList items={l.items} max={100} empty={t('mud.ed.none')} onRemove={l.remove} onToggle={l.toggle}
        describe={(x) => <><kbd>{x.key}</kbd> → <code>{x.send}</code></>}
        form={(x, done) => <KeyForm k={x} done={(v) => { if (v) l.upsert(v); done(); }} />} />
    </>
  );
}

function KeyForm({ k, done }: { k: MudKey | null; done: (v: MudKey | null) => void }) {
  const t = useT();
  const [v, setV] = useState<MudKey>(k ?? { id: newId(), key: '', send: '', enabled: true });
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const submit = () => { const r = mudKeySchema.safeParse(v); if (!r.success || !v.send.trim()) return setError(t('mud.ed.invalid')); done(r.data); };
  return (
    <FormShell onSubmit={submit} onCancel={() => done(null)} error={error}>
      <div className="field">
        <label htmlFor={id}>{t('mud.ed.key')}</label>
        {/* Press the key to record it; Tab still moves on. */}
        <input id={id} readOnly value={v.key} placeholder={t('mud.ed.pressKey')} aria-describedby={`${id}-hint`}
          onKeyDown={(e) => { if (e.key === 'Tab') return; e.preventDefault(); const n = keyName(e); if (n) setV({ ...v, key: n }); }} />
        <p className="hint" id={`${id}-hint`}>{t('mud.ed.keyHint')}</p>
      </div>
      <TextField label={t('mud.ed.sends')} value={v.send} onChange={(x) => setV({ ...v, send: x })} maxLength={1000} required />
    </FormShell>
  );
}

function Buttons() {
  const t = useT();
  const l = useList('buttons');
  return (
    <>
      <p className="hint">{t('mud.ed.buttonsHint')}</p>
      <RuleList items={l.items} max={24} empty={t('mud.ed.none')} onRemove={l.remove}
        describe={(x) => <><strong>{x.label}</strong> → <code>{x.send}</code></>}
        form={(x, done) => <ButtonForm b={x} done={(v) => { if (v) l.upsert(v); done(); }} />} />
    </>
  );
}

function ButtonForm({ b, done }: { b: MudButton | null; done: (v: MudButton | null) => void }) {
  const t = useT();
  const [v, setV] = useState<MudButton>(b ?? { id: newId(), label: '', send: '' });
  const [error, setError] = useState<string | null>(null);
  const submit = () => { const r = mudButtonSchema.safeParse(v); if (!r.success || !v.send.trim()) return setError(t('mud.ed.invalid')); done(r.data); };
  return (
    <FormShell onSubmit={submit} onCancel={() => done(null)} error={error}>
      <TextField label={t('mud.ed.label')} value={v.label} onChange={(x) => setV({ ...v, label: x })} maxLength={20} required />
      <TextField label={t('mud.ed.sends')} value={v.send} onChange={(x) => setV({ ...v, send: x })} maxLength={1000} required />
    </FormShell>
  );
}

// ---------------------------------------------------------------- variables and options

function Variables() {
  const t = useT();
  const { settings, save } = useMud();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const vars = Object.entries(settings.variables);
  const put = (next: Record<string, string>) => save({ ...useMud.getState().settings, variables: next });
  return (
    <>
      <p className="hint">{t('mud.ed.variablesHint')}</p>
      {vars.length === 0 ? <p className="hint">{t('mud.ed.none')}</p> : (
        <ul className="plain mud-rules">
          {vars.map(([k, val]) => (
            <li key={k}><div className="mud-rule-text"><code>@{k}</code> = {val}</div>
              <div className="mud-rule-actions"><button type="button" className="btn btn-quiet" onClick={() => { const n = { ...settings.variables }; delete n[k]; put(n); }}>{t('mud.ed.delete')}</button></div></li>
          ))}
        </ul>
      )}
      <form className="mud-rule-form" onSubmit={(e) => {
        e.preventDefault();
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,30}$/.test(name)) return setError(t('mud.ed.badVarName'));
        if (vars.length >= 100 && !(name in settings.variables)) return setError(t('mud.ed.invalid'));
        put({ ...settings.variables, [name]: value.slice(0, 200) }); setName(''); setValue(''); setError(null);
      }}>
        <TextField label={t('mud.ed.varName')} value={name} onChange={setName} maxLength={31} />
        <TextField label={t('mud.ed.varValue')} value={value} onChange={setValue} maxLength={200} />
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="submit" className="btn">{t('mud.ed.setVar')}</button>
      </form>
    </>
  );
}

function Options() {
  const t = useT();
  const { settings, save } = useMud();
  const o = settings.options;
  const set = (patch: Partial<MudClient['options']>) => save({ ...useMud.getState().settings, options: { ...o, ...patch } });
  return (
    <div className="mud-options">
      <TextField label={t('mud.ed.separator')} hint={t('mud.ed.separatorHint')} value={o.separator} onChange={(x) => { if (x.length >= 1 && x.length <= 2 && !/\s/.test(x)) set({ separator: x }); }} maxLength={2} />
      <Check label={t('mud.ed.speedwalk')} checked={o.speedwalk} onChange={(x) => set({ speedwalk: x })} />
      <Check label={t('mud.ed.echo')} checked={o.echo} onChange={(x) => set({ echo: x })} />
      <Check label={t('mud.ed.numpad')} checked={o.numpad} onChange={(x) => set({ numpad: x })} />
      <Check label={t('mud.ed.panelOpt')} checked={o.panel} onChange={(x) => set({ panel: x })} />
      <Check label={t('mud.ed.screenreader')} checked={o.screenreader} onChange={(x) => set({ screenreader: x })} />
      <p className="hint">{t('mud.ed.screenreaderHint')}</p>
      <Select label={t('mud.ed.fontSize')} value={String(o.fontSize)} options={['12', '13', '14', '15', '16', '18', '20', '22'] as const} onChange={(x) => set({ fontSize: Number(x) })} names={(x) => `${x} px`} />
    </div>
  );
}

// ---------------------------------------------------------------- sharing rules

function Share() {
  const t = useT();
  const { settings, save } = useMud();
  const [pending, setPending] = useState<MudClient | null>(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const shareable = () => { const { history: _h, ...rest } = settings; return rest; }; // history stays private
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(shareable(), null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'mud-rules.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const bring = (raw: string) => {
    let data: unknown;
    try { data = JSON.parse(raw); } catch { return setMsg({ kind: 'error', text: t('mud.ed.importBad') }); }
    const r = mudClientSchema.safeParse(data);
    if (!r.success) return setMsg({ kind: 'error', text: t('mud.ed.importBad') });
    setMsg(null);
    setPending(r.data);
  };
  // Replace your rules with the file's, or add the file's to yours (each rule gets a new id; your variables win).
  const apply = (n: MudClient, replace: boolean) => {
    const merged: MudClient = replace ? { ...n, history: settings.history } : {
      ...settings,
      aliases: [...settings.aliases, ...n.aliases.map((x) => ({ ...x, id: newId() }))].slice(0, 200),
      triggers: [...settings.triggers, ...n.triggers.map((x) => ({ ...x, id: newId() }))].slice(0, 200),
      timers: [...settings.timers, ...n.timers.map((x) => ({ ...x, id: newId() }))].slice(0, 20),
      keys: [...settings.keys, ...n.keys.map((x) => ({ ...x, id: newId() }))].slice(0, 100),
      buttons: [...settings.buttons, ...n.buttons.map((x) => ({ ...x, id: newId() }))].slice(0, 24),
      variables: { ...n.variables, ...settings.variables },
    };
    save(merged);
    setPending(null);
    setText('');
    setMsg({ kind: 'success', text: t('mud.ed.imported') });
  };
  return (
    <>
      <p className="hint">{t('mud.ed.shareHint')}</p>
      <div className="toolbar"><button type="button" className="btn" onClick={download}>{t('mud.ed.export')}</button></div>
      <h3>{t('mud.ed.importTitle')}</h3>
      <div className="field">
        <label htmlFor="mud-import-file">{t('mud.ed.importFile')}</label>
        <input id="mud-import-file" ref={file} type="file" accept="application/json,.json" onChange={async (e) => { const f = e.target.files?.[0]; if (f) bring(await f.text()); if (file.current) file.current.value = ''; }} />
      </div>
      <TextField label={t('mud.ed.importPaste')} multiline value={text} onChange={setText} maxLength={262144} />
      <button type="button" className="btn" disabled={!text.trim()} onClick={() => bring(text)}>{t('mud.ed.importGo')}</button>
      {pending && (
        <div className="panel" role="group" aria-label={t('mud.ed.importAsk')}>
          <p>{t('mud.ed.importAsk')}</p>
          <div className="toolbar">
            <button type="button" className="btn btn-primary" onClick={() => apply(pending, false)}>{t('mud.ed.importAdd')}</button>
            <button type="button" className="btn" onClick={() => apply(pending, true)}>{t('mud.ed.importReplace')}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setPending(null)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
    </>
  );
}
