/** Application lockup derived from the selected flat UT direction. */
export function BrandLogo() {
  return (
    <div className="flex shrink-0 items-center gap-2.5" role="img" aria-label="Unit Talk">
      <svg width="42" height="42" viewBox="0 0 100 90" fill="none" aria-hidden="true">
        <path fill="#F5F4EF" d="M5 5h16v48l15 8V45l15-10v49L5 61V5Zm31 0h57L66 20H50v13L36 43V5Zm30 35 17-10v39l-17 9V40Z" />
        <path fill="#C7A34B" d="M36 44 100 5v9L51 44H36Z" />
      </svg>
      <span className="text-xl font-bold tracking-[0.06em] text-foreground">UNIT TALK</span>
    </div>
  );
}
