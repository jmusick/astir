export function LogoMark() {
  return <svg viewBox="0 0 40 40" width="36" height="36" aria-hidden="true">
    <path d="M4 34V23h10V13h10V4h11v30H24V24H14v10z" fill="currentColor" />
  </svg>;
}

export default function Brand({ href }: { href?: string }) {
  const content = <><LogoMark /><span>astir</span></>;
  return href ? <a className="brand" href={href} aria-label="Astir home">{content}</a> : <span className="brand" aria-label="Astir">{content}</span>;
}
