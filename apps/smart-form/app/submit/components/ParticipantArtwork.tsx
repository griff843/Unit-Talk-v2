'use client';

import { useEffect, useState } from 'react';
import { fetchParticipantMedia, type ParticipantMedia } from '@/lib/participant-media';

export interface ParticipantArtworkProps {
  playerParticipantId?: string | null;
  teamParticipantId?: string | null;
  secondaryTeamParticipantId?: string | null;
  playerName?: string;
  teamName?: string;
  secondaryTeamName?: string;
  sport?: string;
}

/** Same approved emblem geometry as BrandLogo; artwork remains optional. */
export function ParticipantEmblem({ name, className }: { name: string; className?: string }) {
  return <svg role="img" aria-label={name || 'Selected participant'} className={className}
    width="100%" height="100%" viewBox="0 0 740 500" fill="none">
    <path fill="currentColor" d="M18 20h42c57 0 92 39 92 95v176c0 45 23 70 63 70h84V210h86v272H202C85 482 18 412 18 299V20Z" />
    <path fill="currentColor" d="M241 20h481v126H585v210c0 79-54 126-139 126V146H241V20Z" />
  </svg>;
}

export function ArtworkImage({ src, alt, className, fallback }: {
  src: string | null; alt: string; className: string; fallback: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{fallback}</>;
  // Native images tolerate an unavailable provider without a layout shift or
  // requiring another runtime image proxy. Only approved CDN URLs reach here.
  return <img src={src} alt={alt} width={320} height={234} className={className}
    decoding="async" onError={() => setFailed(true)} />;
}

export function ParticipantArtwork({
  playerParticipantId, teamParticipantId, secondaryTeamParticipantId, playerName, teamName, secondaryTeamName, sport = '',
}: ParticipantArtworkProps) {
  const identity = `${sport}|${playerParticipantId ?? ''}|${teamParticipantId ?? ''}|${secondaryTeamParticipantId ?? ''}`;
  const [loaded, setLoaded] = useState<{
    identity: string; player: ParticipantMedia | null; team: ParticipantMedia | null; secondaryTeam: ParticipantMedia | null;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetchParticipantMedia(playerParticipantId, 'player', sport, controller.signal),
      fetchParticipantMedia(teamParticipantId, 'team', sport, controller.signal),
      fetchParticipantMedia(secondaryTeamParticipantId, 'team', sport, controller.signal),
    ]).then(([player, team, secondaryTeam]) => {
      if (!controller.signal.aborted) setLoaded({ identity, player, team, secondaryTeam });
    });
    return () => controller.abort();
  }, [identity, playerParticipantId, teamParticipantId, secondaryTeamParticipantId, sport]);

  if ((!playerParticipantId && !teamParticipantId) || !sport) return null;
  // Comparing at render time prevents even a single frame of old artwork after
  // a team/player/sport change, before effect cleanup has run.
  const media = loaded?.identity === identity ? loaded : null;
  const player = media?.player ?? null;
  const team = media?.team ?? null;
  const name = playerParticipantId ? playerName || player?.displayName : teamName || team?.displayName;
  const label = teamName || team?.displayName || sport;
  const headshot = player?.headshotUrl ?? null;
  const logo = team?.logoUrl ?? null;
  const secondaryLogo = media?.secondaryTeam?.logoUrl ?? null;
  const secondaryLabel = secondaryTeamName || media?.secondaryTeam?.displayName || '';
  return (
    <section className="participant-artwork" aria-label="Selected participant" data-testid="participant-artwork"
      data-player-id={playerParticipantId ?? undefined} data-team-id={teamParticipantId ?? undefined}>
      <div className="participant-artwork-stage">
        <div className="participant-artwork-watermark" aria-hidden="true"><ParticipantEmblem name={name || label} /></div>
        {secondaryTeamParticipantId ? <div className="participant-matchup-logos">
          <ArtworkImage key={`${identity}|away|${logo}`} src={logo} alt={`${label} logo`} className="participant-matchup-logo"
            fallback={<ParticipantEmblem className="participant-matchup-initials" name={label} />} />
          <span className="participant-matchup-at" aria-hidden="true">@</span>
          <ArtworkImage key={`${identity}|home|${secondaryLogo}`} src={secondaryLogo} alt={`${secondaryLabel} logo`} className="participant-matchup-logo"
            fallback={<ParticipantEmblem className="participant-matchup-initials" name={secondaryLabel} />} />
        </div> : playerParticipantId ? <ArtworkImage key={`${identity}|${headshot}`} src={headshot}
          alt={`${name || 'Selected player'} headshot`} className="participant-headshot"
          fallback={<ParticipantEmblem className="participant-initials" name={name || label} />} />
          : <ArtworkImage key={`${identity}|${logo}`} src={logo} alt={`${label} logo`}
            className="participant-primary-logo" fallback={<ParticipantEmblem className="participant-initials" name={name || label} />} />}
        {playerParticipantId && <ArtworkImage key={`${identity}|crest|${logo}`} src={logo}
          alt={`${label} logo`} className="participant-team-crest"
          fallback={<ParticipantEmblem className="participant-team-monogram" name={name || label} />} />}
      </div>
      <div className="participant-artwork-caption">
        <p>{secondaryTeamParticipantId ? sport : `${label}${label !== sport ? ` · ${sport}` : ''}`}</p>
        <h3>{secondaryTeamParticipantId ? `${label} @ ${secondaryLabel}` : name || label}</h3>
      </div>
    </section>
  );
}
