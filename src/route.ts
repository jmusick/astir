import { useEffect, useState } from 'react';

// Which screen is open, kept in the address hash so a reload, Back and the offline shell all work
// without server routes: "#/" or nothing is Today, "#/lists/<id>" is a named list.

export type Route = { screen: 'today' } | { screen: 'list'; listId: string };

export function parseRoute(hash: string): Route {
  const match = /^#\/lists\/([A-Za-z0-9_-]{1,128})$/.exec(hash);
  return match ? { screen: 'list', listId: match[1] } : { screen: 'today' };
}

export const todayHref = '#/';
export const listHref = (listId: string) => `#/lists/${listId}`;

export function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return parseRoute(hash);
}
