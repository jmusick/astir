const FIRST_YEAR = 2026;

/** The version (from package.json at build time) and copyright, under every screen but quick-add. */
export default function Footer() {
  const year = new Date().getFullYear();
  const years = year > FIRST_YEAR ? `${FIRST_YEAR}–${year}` : `${FIRST_YEAR}`;
  return <footer className="app-footer">
    <span>Astir v{__APP_VERSION__}</span>
    <span>© {years} Stone Dragon Media, LLC</span>
  </footer>;
}
