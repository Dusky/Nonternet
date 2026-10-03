import { useQuery } from '@tanstack/react-query';
import type { TowerLeaderboard } from '@app/shared';
import { api } from '../api';
import { OpenAppLink } from './OpenAppLink';
import { useT } from '../hooks';

// The MUD tower's leaderboard (docs/18): the highest floors this season. Shown on the home panel and in the console.
export function TowerBoard({ limit, headingId }: { limit: number; headingId: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ['mud', 'leaderboard'], queryFn: () => api.get<TowerLeaderboard>('/mud/leaderboard'), staleTime: 60_000 });
  const leaders = q.data?.leaders.slice(0, limit) ?? [];
  return (
    <section className="panel" aria-labelledby={headingId}>
      <div className="panel-head">
        <h3 id={headingId}>{q.data?.season ? t('tower.titleSeason', { season: q.data.season }) : t('tower.title')}</h3>
      </div>
      {!q.data ? null : leaders.length === 0 ? <p className="hint">{t('tower.empty')}</p> : (
        <table className="table tower-board">
          <thead><tr><th scope="col">{t('tower.col.rank')}</th><th scope="col">{t('tower.col.character')}</th><th scope="col">{t('tower.col.floor')}</th></tr></thead>
          <tbody>
            {leaders.map((r, i) => (
              <tr key={`${r.handle}-${r.name}`}>
                <td data-label={t('tower.col.rank')}>{i + 1}</td>
                <th scope="row" data-label={t('tower.col.character')}>
                  {r.name} <span className="hint">{t('tower.level', { level: r.level })}, <OpenAppLink app="people" to={r.handle}>{r.handle}</OpenAppLink></span>
                </th>
                <td data-label={t('tower.col.floor')}>{r.best}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
