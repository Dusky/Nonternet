import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { AnnouncementBanner } from '../components/Announcements';
import { RelativeTime } from '../components/ui';
import { useSite, useT } from '../hooks';
import { AppTile } from '../shell/icons';
import { LegalLinks } from './Legal';

interface LandingData {
  online: number;
  threads: { board: { slug: string; name: string }; id: string; subject: string; author: string | null; excerpt: string; last_post_at: string; reply_count: number }[];
  rings: { slug: string; name: string; description: string; members: number }[];
  homepages: { handle: string; title: string; description: string; url: string }[];
}

// The front page for someone who is not signed in (docs/10): what the site is, who's around, a taste
// of what's on it, how to connect, and the way in. Sections with nothing in them are left out.
export function Landing() {
  const t = useT();
  const site = useSite();
  const d = useQuery({ queryKey: ['landing'], queryFn: () => api.get<LandingData>('/landing'), staleTime: 30_000 }).data;
  const note = site.signup_mode === 'invite' ? t('landing.invite') : site.signup_mode === 'open' ? t('landing.open') : t('landing.application');
  const ways = [
    { key: 'web', label: t('landing.connect.web'), how: site.domain },
    ...(site.services.bbs ? [
      { key: 'telnet', label: t('landing.connect.telnet'), how: `telnet ${site.bbs.host} ${site.bbs.telnet_port}` },
      { key: 'ssh', label: t('landing.connect.ssh'), how: `ssh -p ${site.bbs.ssh_port} you@${site.bbs.host}` },
    ] : []),
    ...(site.services.irc ? [{ key: 'irc', label: t('landing.connect.irc'), how: `${site.irc.host}:${site.irc.port} ${site.irc.lobby}` }] : []),
    ...(site.services.mud ? [{ key: 'mud', label: t('landing.connect.mud'), how: `telnet ${site.mud.host} ${site.mud.port}` }] : []),
    ...(site.services.gopher ? [{ key: 'gopher', label: t('landing.connect.gopher'), how: `gopher://${site.gopher.host}${site.gopher.port === 70 ? '' : `:${site.gopher.port}`}/` }] : []),
    ...(site.services.gemini ? [{ key: 'gemini', label: t('landing.connect.gemini'), how: `gemini://${site.gemini.host}${site.gemini.port === 1965 ? '' : `:${site.gemini.port}`}/` }] : []),
    ...(site.services.finger ? [{ key: 'finger', label: t('landing.connect.finger'), how: `finger handle@${site.finger.host}${site.finger.port === 79 ? '' : ` (port ${site.finger.port})`}` }] : []),
  ];

  return (
    <div className="landing">
      <a className="skip" href="#main">{t('nav.skip')}</a>
      <header className="taskbar">
        <Link className="brand" to="/"><span className="brand-mark" aria-hidden="true" />{site.name}</Link>
        <span className="taskbar-account">
          <Link className="btn btn-quiet" to="/login">{t('auth.login')}</Link>
          <Link className="btn btn-primary" to="/signup">{t(site.signup_mode === 'application' ? 'auth.apply' : 'auth.signup')}</Link>
        </span>
      </header>
      <AnnouncementBanner />
      <main id="main" className="landing-main">
        <section className="landing-hero">
          <h1>{t('landing.title')}</h1>
          {site.signup_mode === 'invite' && <p className="landing-sticker" aria-hidden="true">{t('landing.inviteSticker')}</p>}
          <p className="landing-tagline">{t('landing.tagline')}</p>
          {d && d.online > 0 && <p className="landing-online"><span className="online-dot" aria-hidden="true" />{t('landing.online', { count: d.online })}</p>}
          <div className="actions">
            <Link className="btn" to="/boards">{t('landing.browse')}</Link>
            <Link className="btn btn-quiet" to="/rings">{t('landing.browseRings')}</Link>
          </div>
          <p className="hint">{note}</p>
        </section>

        <div className="landing-grid">
          {d && d.threads.length > 0 && (
            <section className="panel landing-posts" aria-labelledby="landing-posts">
              <div className="panel-head"><h2 id="landing-posts">{t('landing.posts')}</h2><Link to="/boards">{t('landing.allBoards')}</Link></div>
              <ul className="rows">
                {d.threads.map((th) => (
                  <li key={th.id}>
                    <div className="row-head">
                      <Link className="thread-link" to={`/boards/${th.board.slug}/t/${th.id}`}><strong>{th.subject || '…'}</strong></Link>
                      <span className="row-meta"><RelativeTime iso={th.last_post_at} /></span>
                    </div>
                    <p className="row-meta">{th.board.name}{th.author ? ` · ${t('boards.by', { name: th.author })}` : ''} · {t('boards.replies', { count: th.reply_count })}</p>
                    <p className="snippet">{th.excerpt}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="landing-side">
            {d && d.rings.length > 0 && (
              <section className="panel" aria-labelledby="landing-rings">
                <div className="panel-head"><h2 id="landing-rings">{t('landing.rings')}</h2><Link to="/rings">{t('landing.allRings')}</Link></div>
                <ul className="rows">
                  {d.rings.map((r) => (
                    <li key={r.slug}>
                      <Link to={`/rings/${r.slug}`}><strong>{r.name}</strong></Link> <span className="row-meta">{t('rings.members', { count: r.members })}</span>
                      {r.description && <p className="snippet">{r.description}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {d && d.homepages.length > 0 && (
              <section className="panel" aria-labelledby="landing-homes">
                <div className="panel-head"><h2 id="landing-homes">{t('landing.homepages')}</h2><Link to="/homepages">{t('landing.allHomepages')}</Link></div>
                <ul className="rows">
                  {d.homepages.map((h) => (
                    <li key={h.handle}>
                      <a href={h.url} target="_blank" rel="noopener noreferrer"><strong>{h.title || h.handle}</strong></a>
                      {h.description && <p className="snippet">{h.description}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="panel" aria-labelledby="landing-connect">
              <h2 id="landing-connect">{t('landing.connect')}</h2>
              <dl className="connect">
                {ways.map((w) => (
                  <div key={w.key}>
                    <dt>{w.key === 'web' ? <AppTile id="boards" /> : <AppTile id={w.key === 'irc' ? 'chat' : w.key === 'mud' ? 'mud' : 'terminal'} />}{w.label}</dt>
                    <dd><code>{w.how}</code></dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </div>
        <footer className="landing-footer"><LegalLinks /></footer>
      </main>
    </div>
  );
}
