import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PUSH_KINDS, type PushDevice, type PushKind } from '@app/shared';
import { api, ApiError } from '../../api';
import { undoable } from '../../components/feedback';
import { Alert } from '../../components/ui';
import { errorText, useT } from '../../hooks';
import { deviceLabel } from '../../deviceLabel';
import { DeviceSwitch } from './PersonalSettings';
import { Section } from './Section';

// Push notifications on this device (docs/10): a phone or computer hears about mail and replies even with the site
// closed. Each device chooses its own kinds; other devices can be removed from here. Off when the site has no keys.
const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';

async function worker(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration()) ?? navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export function DevicePush() {
  const t = useT();
  const qc = useQueryClient();
  const key = useQuery({ queryKey: ['push-key'], queryFn: () => api.get<{ key: string | null }>('/push'), staleTime: Infinity });
  const devices = useQuery({ queryKey: ['push-devices'], queryFn: () => api.get<{ devices: PushDevice[] }>('/me/push'), enabled: Boolean(key.data?.key) });
  const [endpoint, setEndpoint] = useState<string | null>(null); // this browser's push address, if it has one
  const [going, setGoing] = useState<string[]>([]);
  const [kindsNow, setKindsNow] = useState<PushKind[] | null>(null); // the same for the kinds
  const [want, setWant] = useState<boolean | null>(null); // the switch moves in the click; this holds it until the browser and server agree
  const refresh = () => void qc.invalidateQueries({ queryKey: ['push-devices'] });

  useEffect(() => {
    if (!supported()) return;
    void navigator.serviceWorker.getRegistration().then((r) => r?.pushManager.getSubscription()).then((s) => setEndpoint(s?.endpoint ?? null)).catch(() => undefined);
  }, []);

  const mine = devices.data?.devices.find((d) => d.endpoint === endpoint) ?? null;
  const others = (devices.data?.devices ?? []).filter((d) => d.endpoint !== endpoint && !going.includes(d.id));

  const turnOn = useMutation({
    mutationFn: async () => {
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('denied');
      const reg = await worker();
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key.data!.key! });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api.post('/me/push', { endpoint: json.endpoint, keys: json.keys, kinds: [...PUSH_KINDS], label: deviceLabel(navigator.userAgent) });
      setEndpoint(json.endpoint);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['push-devices'] }), // waited for, so the switch doesn't flicker back
    onSettled: () => setWant(null),
  });
  const turnOff = useMutation({
    mutationFn: async () => {
      const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      await sub?.unsubscribe();
      if (mine) await api.del(`/me/push/${mine.id}`);
      setEndpoint(null);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['push-devices'] }), // waited for, so the switch doesn't flicker back
    onSettled: () => setWant(null),
  });
  const kinds = useMutation({
    mutationFn: (next: PushKind[]) => api.patch(`/me/push/${mine!.id}`, { kinds: next }),
    onSettled: async () => { await qc.invalidateQueries({ queryKey: ['push-devices'] }); setKindsNow(null); },
  });

  if (!key.data?.key) return null; // this site sends no push notifications
  const busy = turnOn.isPending || turnOff.isPending;
  const failure = turnOn.error ?? turnOff.error ?? kinds.error;
  return (
    <Section id="push-h" title={t('push.device.title')} scope="device" intro={t('push.device.intro')}>
      {!supported() ? <p className="hint">{t('push.device.unsupported')}</p> : (
        <>
          <DeviceSwitch label={t('push.device.on')} checked={want ?? Boolean(mine)} disabled={busy}
            onChange={(on) => { setWant(on); if (on) turnOn.mutate(); else turnOff.mutate(); }} />
          {typeof Notification !== 'undefined' && Notification.permission === 'denied' && <p className="field-error">{t('push.device.denied')}</p>}
          {mine && (
            <fieldset className="checks">
              <legend>{t('push.kinds.legend')}</legend>
              {PUSH_KINDS.map((k) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={(kindsNow ?? mine.kinds).includes(k)}
                    onChange={(e) => {
                      const now = kindsNow ?? mine.kinds;
                      const next = e.target.checked ? [...now, k] : now.filter((x) => x !== k);
                      setKindsNow(next);
                      kinds.mutate(next);
                    }} />
                  {t(`push.kind.${k}`)}
                </label>
              ))}
            </fieldset>
          )}
        </>
      )}
      {failure && <Alert kind="error">{failure instanceof ApiError ? errorText(failure) : (failure as Error).message === 'denied' ? t('push.device.denied') : t('push.device.failed')}</Alert>}
      {others.length > 0 && (
        <section aria-labelledby="push-others-h">
          <h3 id="push-others-h">{t('push.others.title')}</h3>
          <ul className="rows">
            {others.map((d) => {
              const name = d.label || t('push.others.unnamed');
              return (
                <li key={d.id}>
                  <strong>{name}</strong>
                  <p className="hint">{d.kinds.length ? d.kinds.map((k) => t(`push.kind.${k}`)).join(', ') : t('push.others.nothing')}</p>
                  <button type="button" className="btn btn-quiet" aria-label={t('push.others.removeLabel', { name })}
                    onClick={() => {
                      const back = () => setGoing((g) => g.filter((x) => x !== d.id));
                      setGoing((g) => [...g, d.id]);
                      undoable(t('push.others.removed', { name }), () => api.del(`/me/push/${d.id}`).then(refresh), { onUndo: back, onError: back });
                    }}>{t('ssh.remove')}</button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Section>
  );
}
