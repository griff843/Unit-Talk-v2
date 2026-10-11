export function ResultsAvailability() {
  return (
    <div className="ut-availability">
      <span className="ut-tag">Public archive unavailable</span>
      <h3>The complete record belongs here.</h3>
      <p>
        The public results archive is not available on this website yet.
        Records, net units, ROI and CLV are unavailable here.
      </p>
      <div
        role="list"
        className="ut-outcomes"
        aria-label="Outcomes included in the transparency policy"
      >
        {['Wins', 'Losses', 'Pushes', 'Voids', 'Corrections'].map((label) => (
          <span role="listitem" key={label}>
            {label}
          </span>
        ))}
      </div>
      <p className="mt-5 border-t border-[var(--ut-border-subtle)] pt-4 text-xs">
        Every outcome belongs in the record, including losses and correction
        history.
      </p>
    </div>
  );
}
