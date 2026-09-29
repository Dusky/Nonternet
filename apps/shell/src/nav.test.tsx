// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach } from 'vitest';
import { AppLink, AppNavLink, matchRoute, PageNav, useAppNav, WindowNav } from './nav';

afterEach(cleanup);

describe('matchRoute', () => {
  const routes = ['users', 'users/:id', 'invites', 'audit'] as const;
  it('matches plain and parameterised routes', () => {
    expect(matchRoute('users', routes)).toEqual({ pattern: 'users', params: {} });
    expect(matchRoute('users/u_123', routes)).toEqual({ pattern: 'users/:id', params: { id: 'u_123' } });
    expect(matchRoute('/invites/', routes)).toEqual({ pattern: 'invites', params: {} });
  });
  it('does not match unknown or over-long paths', () => {
    expect(matchRoute('', routes)).toBeNull();
    expect(matchRoute('nope', routes)).toBeNull();
    expect(matchRoute('users/a/b', routes)).toBeNull();
  });
  it('decodes captured values, and does not throw on a malformed escape', () => {
    expect(matchRoute('users/a%20b', routes)!.params.id).toBe('a b');
    expect(matchRoute('users/%E0%A4%A', routes)).toBeNull();
  });
});

function Screen() {
  const nav = useAppNav();
  return (
    <div>
      <p data-testid="path">{nav.path || '(start)'}</p>
      <AppNavLink to="users">Users</AppNavLink>
      <AppLink to="users/u_1">One user</AppLink>
    </div>
  );
}
function Where() { return <p data-testid="url">{useLocation().pathname}</p>; }

describe('in a window', () => {
  it('moves between screens without touching the address bar', async () => {
    render(<MemoryRouter initialEntries={['/']}><Where /><WindowNav><Screen /></WindowNav></MemoryRouter>);
    expect(screen.getByTestId('path').textContent).toBe('(start)');
    await userEvent.click(screen.getByRole('link', { name: 'One user' }));
    expect(screen.getByTestId('path').textContent).toBe('users/u_1');
    expect(screen.getByTestId('url').textContent).toBe('/'); // the address bar did not change
    expect(screen.getByRole('link', { name: 'Users' }).getAttribute('aria-current')).toBe('page'); // the section is still current
  });

  it('two windows keep their own place', async () => {
    render(<><WindowNav><Screen /></WindowNav><WindowNav><Screen /></WindowNav></>);
    await userEvent.click(screen.getAllByRole('link', { name: 'Users' })[0]!);
    expect(screen.getAllByTestId('path').map((n) => n.textContent)).toEqual(['users', '(start)']);
  });
});

describe('on a page of its own', () => {
  it('follows the address bar under its base, and moves it', async () => {
    render(<MemoryRouter initialEntries={['/admin/users/u_9']}><Where /><PageNav base="/admin"><Screen /></PageNav></MemoryRouter>);
    expect(screen.getByTestId('path').textContent).toBe('users/u_9');
    await userEvent.click(screen.getByRole('link', { name: 'Users' }));
    expect(screen.getByTestId('url').textContent).toBe('/admin/users');
    expect(screen.getByTestId('path').textContent).toBe('users');
  });

  it('gives links real addresses, so they can be opened in a new tab', () => {
    render(<MemoryRouter initialEntries={['/admin']}><PageNav base="/admin"><Screen /></PageNav></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'One user' }).getAttribute('href')).toBe('/admin/users/u_1');
  });

  it('leaves modified clicks to the browser (new tab, new window)', () => {
    render(<MemoryRouter initialEntries={['/admin']}><Where /><PageNav base="/admin"><Screen /></PageNav></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'Users' });
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) fireEvent.click(link, mod);
    expect(screen.getByTestId('url').textContent).toBe('/admin'); // we did not intercept any of them
    fireEvent.click(link); // a plain click is ours
    expect(screen.getByTestId('url').textContent).toBe('/admin/users');
  });
});
