import { useEffect } from 'react';
import { SideNav } from '../../components/ui';
import { useMe, useSite, useT } from '../../hooks';
import { matchRoute, useAppNav } from '../../nav';
import { YourData } from './YourData';
import { Blocks } from './Blocks';
import { OfflineMail, SshKeys, TerminalPassword } from './Terminal';
import { BoardSettings, ChatAccountSettings, ChatSettings, NotificationChoices, PersonalProfile, TerminalDisplay } from './PersonalSettings';
import { Profile, FeaturedCharacter } from './ProfileTab';
import { Password, TwoFactor } from './SecurityTab';
import { EmailAddress, Handle } from './AccountTab';
import { Appearance, DeviceAlerts } from './AppearanceTab';

const ROUTES = ['profile', 'account', 'password', 'two-factor', 'terminal', 'data', 'blocked', 'appearance', 'notifications', 'chat', 'boards'] as const;

export default function SettingsApp() {
  const t = useT();
  const me = useMe().data;
  const site = useSite();
  const nav = useAppNav();
  const route = matchRoute(nav.path, ROUTES);
  // Opening the app (or a screen that doesn't exist) lands on the first screen.
  useEffect(() => { if (!route) nav.go('profile', { replace: true }); }, [route]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!me) return null;
  return (
    <SideNav label={t('app.settings')} groups={[{ items: [
      { to: 'profile', label: t('settings.tab.profile') },
      { to: 'appearance', label: t('settings.tab.appearance') },
      { to: 'notifications', label: t('settings.tab.notifications') },
      ...(site.services.irc && me.role !== 'guest' ? [{ to: 'chat', label: t('settings.tab.chat') }] : []),
      ...(me.role !== 'guest' ? [{ to: 'boards', label: t('settings.tab.boards') }] : []),
      { to: 'account', label: t('settings.tab.account') },
      { to: 'password', label: t('settings.tab.password') },
      { to: 'two-factor', label: t('settings.tab.twofa') },
      { to: 'terminal', label: t('settings.tab.terminal') },
      ...(me.role !== 'guest' ? [{ to: 'blocked', label: t('settings.tab.blocked') }] : []),
      { to: 'data', label: t('settings.tab.data') },
    ] }]}>
      {route?.pattern === 'profile' && <><Profile me={me} />{me.role !== 'guest' && <PersonalProfile me={me} />}{site.services.mud && <FeaturedCharacter />}</>}
      {route?.pattern === 'account' && <><EmailAddress me={me} /><Handle me={me} /></>}
      {route?.pattern === 'password' && <Password />}
      {route?.pattern === 'two-factor' && <TwoFactor me={me} />}
      {route?.pattern === 'terminal' && <><TerminalDisplay /><TerminalPassword />{site.services.bbs && me.role !== 'guest' && <><SshKeys /><OfflineMail /></>}</>}
      {route?.pattern === 'data' && <YourData me={me} />}
      {route?.pattern === 'blocked' && <Blocks />}
      {route?.pattern === 'appearance' && <Appearance me={me} />}
      {route?.pattern === 'notifications' && <>{me.role !== 'guest' && <NotificationChoices />}<DeviceAlerts /></>}
      {route?.pattern === 'chat' && <><ChatSettings /><ChatAccountSettings /></>}
      {route?.pattern === 'boards' && <BoardSettings />}
    </SideNav>
  );
}
