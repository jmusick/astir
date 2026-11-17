import { useEffect, useState } from 'react';

// Which screen is open, kept in the address hash so a reload, Back and the offline shell all work
// without server routes: "#/" or nothing is Today, "#/lists/<id>" is a named list, and
// "#/history" or "#/history/<YYYY-MM-DD>" looks back at a past day.

export type Route = { screen: 'today' } | { screen: 'list'; listId: string } | { screen: 'history'; day: string | null };

export function parseRoute(hash: string): Route {
  const list = /^#\/lists\/([A-Za-z0-9_-]{1,128})$/.exec(hash);
  if (list) return { screen: 'list', listId: list[1] };
  const history = /^#\/history(?:\/(\d{4}-\d{2}-\d{2}))?$/.exec(hash);
  if (history) return { screen: 'history', day: history[1] ?? null };
  return { screen: 'today' };
}

export const todayHref = '#/';
export const listHref = (listId: string) => `#/lists/${listId}`;
export const historyHref = (day?: string) => day ? `#/history/${day}` : '#/history';

export function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return parseRoute(hash);
}
