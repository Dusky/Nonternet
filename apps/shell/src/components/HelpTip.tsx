import type { ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Popover } from 'react-aria-components';
import { useT } from '../hooks';

// A "?" beside a heading that opens the longer explanation on demand (docs/10, interface writing rule): the screen
// stays short for people who know it, and the help is one press away for people who don't. Escape or a click
// elsewhere closes it, and focus goes back to the "?".
export function HelpTip({ topic, children }: { topic: string; children: ReactNode }) {
  const t = useT();
  return (
    <DialogTrigger>
      <Button className="help-tip" aria-label={t('help.about', { topic })}>?</Button>
      <Popover placement="bottom start" offset={6} className="help-pop">
        <Dialog className="help-body" aria-label={t('help.about', { topic })}>{children}</Dialog>
      </Popover>
    </DialogTrigger>
  );
}
