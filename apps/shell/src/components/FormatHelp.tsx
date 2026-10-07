import { useT } from '../hooks';
import { HelpTip } from './HelpTip';

// The formatting posts and mail understand (docs/23), behind a "?" next to the box.
export function FormatHelp() {
  const t = useT();
  return (
    <HelpTip topic={t('format.helpTopic')}>
      <p>{t('format.help1')}</p>
      <pre className="wiki-source">{t('format.help2')}</pre>
    </HelpTip>
  );
}
