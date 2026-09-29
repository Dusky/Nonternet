import type { PublicSite } from '@app/shared';
import { en, type StringKey } from './en';

export { en };
export type { StringKey };

export type Params = Record<string, string | number>;

// Fill {site.*} from config and {other} from params. An unknown placeholder is an error, not a
// silent blank, so a typo in a string is caught by the tests instead of shipping.
export function format(template: string, site: Pick<PublicSite, 'name' | 'short_name' | 'domain' | 'homes_domain'>, params: Params = {}): string {
  return template.replace(/\{([a-z_.A-Z0-9]+)\}/g, (_m, key: string) => {
    if (key.startsWith('site.')) {
      const value = (site as Record<string, string>)[key.slice('site.'.length)];
      if (value === undefined) throw new Error(`Unknown site placeholder {${key}}`);
      return value;
    }
    const value = params[key];
    if (value === undefined) throw new Error(`Missing value for {${key}}`);
    return String(value);
  });
}

export function makeT(site: Pick<PublicSite, 'name' | 'short_name' | 'domain' | 'homes_domain'>) {
  return (key: StringKey, params?: Params): string => format(en[key], site, params);
}
