const paths = {
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  history: <path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7m2-4v5l3 2" />,
  list: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m8 5 7 7-7 7" />,
  edit: <><path d="m5 15 10-10 4 4L9 19H5zM13 7l4 4" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  grip: <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth="3" />,
  repeat: <path d="m17 3 3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3m16-2v2a3 3 0 0 1-3 3H4" />,
};

export default function Icon({ name }: { name: keyof typeof paths }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
