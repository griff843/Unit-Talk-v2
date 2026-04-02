'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type {
  BrowseSearchResult,
  EventBrowseResult,
  EventOfferBrowseResult,
  MatchupBrowseResult,
  SubmitPickResult,
} from '@/lib/api-client';
import {
  getCatalog,
  getEventBrowse,
  getMatchups,
  searchBrowse,
  submitPick,
} from '@/lib/api-client';
import type { CatalogData, SportDefinition, SportsbookDefinition } from '@/lib/catalog';
import {
  buildParticipantSearchUrl,
  isRecord,
  normalizeParticipantSearchResults,
  type ParticipantSearchType,
  type ParticipantSuggestion,
} from '@/lib/participant-search';
import {
  buildSubmissionPayload,
  getMarketTypesForSport,
  getStatTypesForSport,
  inferStatTypeFromMarketTypeId,
  mapOfferToFormMarketType,
  resolveSportsbookId,
} from '@/lib/form-utils';
import { betFormSchema, type BetFormValues, type MarketTypeId } from '@/lib/form-schema';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { BetSlipPanel } from './BetSlipPanel';
import { MarketTypeGrid } from './MarketTypeGrid';
import { SuccessReceipt } from './SuccessReceipt';

export { buildParticipantSearchUrl, normalizeParticipantSearchResults };

const TODAY = new Date().toISOString().slice(0, 10);
const PARTICIPANT_QUERY_MIN = 2;
const BROWSE_SEARCH_MIN = 2;
const OFFER_STALE_MINUTES = 30;

type BrowseMode = 'live-offer' | 'manual';
type LiveEntryMode = 'browse' | 'search';
type OfferSelectionSide = 'over' | 'under' | 'side';
type ParticipantFieldName = 'playerName' | 'team';

interface SelectedOfferState {
  offer: EventOfferBrowseResult;
  side: OfferSelectionSide;
}

interface ParticipantAutocompleteFieldProps {
  form: UseFormReturn<BetFormValues>;
  name: ParticipantFieldName;
  label: string;
  placeholder: string;
  searchType: ParticipantSearchType;
  sport: string;
  onSuggestionSelected: (suggestion: ParticipantSuggestion) => void;
  onManualChange: () => void;
}

function roleSortOrder(role: string) {
  return role === 'home' ? 0 : role === 'away' ? 1 : 2;
}

function formatMatchup(matchup: MatchupBrowseResult) {
  const orderedTeams = [...matchup.teams].sort(
    (left, right) => roleSortOrder(left.role) - roleSortOrder(right.role),
  );
  if (orderedTeams.length >= 2) {
    return `${orderedTeams[1]?.displayName ?? 'Away'} @ ${orderedTeams[0]?.displayName ?? 'Home'}`;
  }
  return matchup.eventName;
}

function formatTimestampLabel(isoString: string) {
  const timestamp = new Date(isoString);
  if (Number.isNaN(timestamp.getTime())) {
    return 'Unknown time';
  }
  return timestamp.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatSearchTimestamp(isoString: string) {
  const timestamp = new Date(isoString);
  if (Number.isNaN(timestamp.getTime())) {
    return 'Unknown time';
  }

  return timestamp.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildSearchResultTone(resultType: BrowseSearchResult['resultType']) {
  if (resultType === 'player') {
    return 'PLAYER';
  }
  if (resultType === 'team') {
    return 'TEAM';
  }
  return 'MATCHUP';
}

function getOfferAgeMinutes(snapshotAt: string) {
  const parsed = Date.parse(snapshotAt);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.max(0, Math.floor((Date.now() - parsed) / 60000));
}

function buildOfferStatus(eventBrowse: EventBrowseResult | null) {
  if (!eventBrowse || eventBrowse.offers.length === 0) {
    return { tone: 'none' as const, label: 'No live offers' };
  }

  const ages = eventBrowse.offers
    .map((offer) => getOfferAgeMinutes(offer.snapshotAt))
    .filter((value): value is number => value !== null);
  if (ages.length === 0) {
    return { tone: 'live' as const, label: 'Live offers available' };
  }

  const youngestOfferMinutes = Math.min(...ages);
  if (youngestOfferMinutes > OFFER_STALE_MINUTES) {
    return {
      tone: 'stale' as const,
      label: `Stale offers (${youngestOfferMinutes}m old)`,
    };
  }

  return { tone: 'live' as const, label: 'Live offers available' };
}

function ParticipantAutocompleteField({
  form,
  name,
  label,
  placeholder,
  searchType,
  sport,
  onSuggestionSelected,
  onManualChange,
}: ParticipantAutocompleteFieldProps) {
  const value = useWatch({ control: form.control, name }) ?? '';
  const [isFocused, setIsFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ParticipantSuggestion[]>([]);

  useEffect(() => {
    const query = value.trim();
    if (!sport || query.length < PARTICIPANT_QUERY_MIN) {
      setSuggestions([]);
      setHasSearched(false);
      setSearchError(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsLoading(true);
      setHasSearched(false);
      setSearchError(null);

      try {
        const response = await fetch(buildParticipantSearchUrl(query, searchType, sport), {
          signal: controller.signal,
        });
        let json: unknown = null;

        try {
          json = await response.json();
        } catch {
          json = null;
        }

        if (!response.ok) {
          const message = isRecord(json) && isRecord(json.error) && typeof json.error.message === 'string'
            ? json.error.message
            : 'Participant search unavailable';
          throw new Error(message);
        }

        setSuggestions(
          normalizeParticipantSearchResults(
            isRecord(json) ? json : { data: [] },
            searchType,
          ),
        );
        setHasSearched(true);
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          return;
        }

        setSuggestions([]);
        setHasSearched(true);
        setSearchError(error instanceof Error ? error.message : 'Participant search unavailable');
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [name, searchType, sport, value]);

  const shouldShowMenu =
    isFocused &&
    value.trim().length >= PARTICIPANT_QUERY_MIN &&
    (isLoading || hasSearched || searchError !== null);

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="relative">
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              autoComplete="off"
              placeholder={placeholder}
              value={field.value ?? ''}
              onFocus={() => setIsFocused(true)}
              onBlur={() => {
                window.setTimeout(() => setIsFocused(false), 120);
              }}
              onChange={(event) => {
                onManualChange();
                field.onChange(event.target.value);
                setSearchError(null);
              }}
            />
          </FormControl>
          {shouldShowMenu ? (
            <div className="absolute inset-x-0 top-full z-20 mt-2 rounded-md border border-border bg-background shadow-lg">
              {isLoading ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">Searching participants...</div>
              ) : null}
              {!isLoading && searchError ? (
                <div className="px-3 py-2 text-sm text-destructive">{searchError}</div>
              ) : null}
              {!isLoading && !searchError && hasSearched && suggestions.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">No matching participants found.</div>
              ) : null}
              {!isLoading && !searchError && suggestions.length > 0 ? (
                <div className="py-1">
                  {suggestions.map((suggestion) => (
                    <button
                      key={`${suggestion.participantType}:${suggestion.participantId}`}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        form.setValue(name, suggestion.displayName, {
                          shouldDirty: true,
                          shouldTouch: true,
                          shouldValidate: true,
                        });
                        form.clearErrors(name);
                        onSuggestionSelected(suggestion);
                        setIsFocused(false);
                      }}
                    >
                      <span>{suggestion.displayName}</span>
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {suggestion.participantType}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function buildOfferButtonLabel(offer: EventOfferBrowseResult, side: OfferSelectionSide) {
  if (side === 'side') {
    const odds = offer.overOdds;
    return odds == null
      ? 'Select'
      : `${offer.participantName ?? 'Select'} ${odds > 0 ? `+${odds}` : odds}`;
  }

  const odds = side === 'over' ? offer.overOdds : offer.underOdds;
  const label = side === 'over' ? 'Over' : 'Under';
  return odds == null ? label : `${label} ${odds > 0 ? `+${odds}` : odds}`;
}

function OfferButton({
  offer,
  side,
  isSelected,
  onSelect,
}: {
  offer: EventOfferBrowseResult;
  side: OfferSelectionSide;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const odds = side === 'side'
    ? offer.overOdds
    : side === 'over'
      ? offer.overOdds
      : offer.underOdds;

  if (odds == null) {
    return null;
  }

  return (
    <Button
      type="button"
      variant={isSelected ? 'default' : 'outline'}
      className="justify-start"
      onClick={onSelect}
    >
      {buildOfferButtonLabel(offer, side)}
    </Button>
  );
}

export function BetForm() {
  const { toast } = useToast();
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [browseMode, setBrowseMode] = useState<BrowseMode>('live-offer');
  const [liveEntryMode, setLiveEntryMode] = useState<LiveEntryMode>('browse');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successResult, setSuccessResult] = useState<SubmitPickResult | null>(null);
  const [submittedValues, setSubmittedValues] = useState<BetFormValues | null>(null);
  const [matchups, setMatchups] = useState<MatchupBrowseResult[]>([]);
  const [matchupsError, setMatchupsError] = useState<string | null>(null);
  const [isLoadingMatchups, setIsLoadingMatchups] = useState(false);
  const [selectedMatchupId, setSelectedMatchupId] = useState<string | null>(null);
  const [eventBrowse, setEventBrowse] = useState<EventBrowseResult | null>(null);
  const [eventBrowseError, setEventBrowseError] = useState<string | null>(null);
  const [isLoadingEventBrowse, setIsLoadingEventBrowse] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedOffer, setSelectedOffer] = useState<SelectedOfferState | null>(null);
  const [selectedOfferParticipantId, setSelectedOfferParticipantId] = useState<string | null>(null);
  const [suspendMarketReset, setSuspendMarketReset] = useState(false);
  const [browseSearchQuery, setBrowseSearchQuery] = useState('');
  const [browseSearchResults, setBrowseSearchResults] = useState<BrowseSearchResult[]>([]);
  const [browseSearchError, setBrowseSearchError] = useState<string | null>(null);
  const [isSearchingBrowse, setIsSearchingBrowse] = useState(false);
  const [hasSearchedBrowse, setHasSearchedBrowse] = useState(false);

  const form = useForm<BetFormValues>({
    resolver: zodResolver(betFormSchema),
    defaultValues: {
      sport: '',
      eventName: '',
      playerName: '',
      statType: '',
      team: '',
      sportsbook: '',
      capperConviction: undefined,
      units: 1.0,
      odds: undefined,
      line: undefined,
      gameDate: TODAY,
    },
  });

  const watchedValues = form.watch();
  const selectedSport = watchedValues.sport;
  const selectedMarketType = watchedValues.marketType;
  const emptyCatalog: CatalogData = { sports: [], sportsbooks: [], ticketTypes: [], cappers: [] };
  const selectedMatchup = useMemo(
    () => matchups.find((matchup) => matchup.eventId === selectedMatchupId) ?? null,
    [matchups, selectedMatchupId],
  );
  const availableMarketTypes = selectedSport
    ? getMarketTypesForSport(catalog ?? emptyCatalog, selectedSport)
    : [];
  const availableStatTypes = selectedSport
    ? getStatTypesForSport(catalog ?? emptyCatalog, selectedSport)
    : [];
  const availableOfferFamilies = useMemo(() => {
    if (!eventBrowse) {
      return [] as MarketTypeId[];
    }

    return Array.from(
      new Set(eventBrowse.offers.map((offer) => mapOfferToFormMarketType(offer))),
    );
  }, [eventBrowse]);
  const groupedPlayers = useMemo(() => {
    if (!eventBrowse) {
      return [] as Array<{
        teamName: string;
        players: EventBrowseResult['participants'];
      }>;
    }

    const playerParticipants = eventBrowse.participants
      .filter((participant) => participant.participantType === 'player')
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
    const groups = new Map<string, typeof playerParticipants>();

    for (const player of playerParticipants) {
      const teamName = player.teamName ?? 'Unassigned';
      const existing = groups.get(teamName) ?? [];
      existing.push(player);
      groups.set(teamName, existing);
    }

    return Array.from(groups.entries())
      .map(([teamName, players]) => ({ teamName, players }))
      .sort((left, right) => left.teamName.localeCompare(right.teamName));
  }, [eventBrowse]);
  const filteredOffers = useMemo(() => {
    if (!eventBrowse || !selectedMarketType) {
      return [] as EventOfferBrowseResult[];
    }

    return eventBrowse.offers.filter((offer) => {
      if (mapOfferToFormMarketType(offer) !== selectedMarketType) {
        return false;
      }
      if (
        selectedMarketType === 'player-prop' &&
        selectedOfferParticipantId &&
        offer.participantId !== selectedOfferParticipantId
      ) {
        return false;
      }
      return true;
    });
  }, [eventBrowse, selectedMarketType, selectedOfferParticipantId]);
  const offerStatus = buildOfferStatus(eventBrowse);
  const shouldShowManualFallback =
    browseMode === 'manual' ||
    !selectedMatchup ||
    !eventBrowse ||
    filteredOffers.length === 0;

  useEffect(() => {
    getCatalog()
      .then(setCatalog)
      .catch((err: unknown) => setCatalogError(err instanceof Error ? err.message : 'Reference data unavailable'));
  }, []);

  // Auto-select capper when catalog loads with exactly one option and no capper is set yet.
  useEffect(() => {
    if (catalog && catalog.cappers.length === 1 && !form.getValues('capper')) {
      form.setValue('capper', catalog.cappers[0]!, { shouldValidate: true });
    }
  }, [catalog, form]);

  useEffect(() => {
    setSelectedMatchupId(null);
    setEventBrowse(null);
    setEventBrowseError(null);
    setSelectedOffer(null);
    setSelectedOfferParticipantId(null);
    setSelectedPlayerId(null);
    setSelectedTeamId(null);
    setBrowseSearchQuery('');
    setBrowseSearchResults([]);
    setBrowseSearchError(null);
    setHasSearchedBrowse(false);

    form.resetField('marketType');
    form.setValue('eventName', '');
    form.setValue('playerName', '');
    form.setValue('statType', '');
    form.setValue('team', '');
    form.resetField('direction');
    form.resetField('line');
    form.resetField('odds');
    form.setValue('sportsbook', '');
  }, [selectedSport, form]);

  useEffect(() => {
    if (browseMode !== 'live-offer' || !selectedSport || !watchedValues.gameDate) {
      setMatchups([]);
      setMatchupsError(null);
      setIsLoadingMatchups(false);
      return;
    }

    let active = true;
    setIsLoadingMatchups(true);
    setMatchupsError(null);

    getMatchups(selectedSport, watchedValues.gameDate)
      .then((results) => {
        if (!active) return;
        setMatchups(results);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMatchups([]);
        setMatchupsError(error instanceof Error ? error.message : 'Unable to load matchups');
      })
      .finally(() => {
        if (!active) return;
        setIsLoadingMatchups(false);
      });

    return () => {
      active = false;
    };
  }, [browseMode, selectedSport, watchedValues.gameDate]);

  useEffect(() => {
    const query = browseSearchQuery.trim();
    if (
      browseMode !== 'live-offer' ||
      !selectedSport ||
      !watchedValues.gameDate ||
      query.length < BROWSE_SEARCH_MIN
    ) {
      setBrowseSearchResults([]);
      setBrowseSearchError(null);
      setHasSearchedBrowse(false);
      setIsSearchingBrowse(false);
      return;
    }

    let active = true;
    const timeoutId = window.setTimeout(() => {
      setIsSearchingBrowse(true);
      setBrowseSearchError(null);

      searchBrowse(selectedSport, watchedValues.gameDate, query)
        .then((results) => {
          if (!active) {
            return;
          }

          setBrowseSearchResults(results);
          setHasSearchedBrowse(true);
        })
        .catch((error: unknown) => {
          if (!active) {
            return;
          }

          setBrowseSearchResults([]);
          setHasSearchedBrowse(true);
          setBrowseSearchError(error instanceof Error ? error.message : 'Search unavailable');
        })
        .finally(() => {
          if (!active) {
            return;
          }

          setIsSearchingBrowse(false);
        });
    }, 200);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [browseMode, browseSearchQuery, selectedSport, watchedValues.gameDate]);

  useEffect(() => {
    if (browseMode !== 'live-offer' || !selectedMatchupId) {
      setEventBrowse(null);
      setEventBrowseError(null);
      setIsLoadingEventBrowse(false);
      return;
    }

    let active = true;
    setIsLoadingEventBrowse(true);
    setEventBrowseError(null);

    getEventBrowse(selectedMatchupId)
      .then((result) => {
        if (!active) return;
        setEventBrowse(result);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setEventBrowse(null);
        setEventBrowseError(error instanceof Error ? error.message : 'Unable to load live offers');
      })
      .finally(() => {
        if (!active) return;
        setIsLoadingEventBrowse(false);
      });

    return () => {
      active = false;
    };
  }, [browseMode, selectedMatchupId]);

  useEffect(() => {
    if (suspendMarketReset) {
      setSuspendMarketReset(false);
      return;
    }

    form.setValue('playerName', '');
    form.setValue('statType', '');
    form.setValue('team', '');
    form.setValue('direction', undefined);
    form.setValue('line', undefined);
    setSelectedOffer(null);
    setSelectedOfferParticipantId(null);
    setSelectedPlayerId(null);
    setSelectedTeamId(null);
  }, [form, selectedMarketType, suspendMarketReset]);

  function upsertMatchup(matchup: MatchupBrowseResult) {
    setMatchups((current) => {
      const existing = current.find((row) => row.eventId === matchup.eventId);
      if (existing) {
        return current.map((row) => (row.eventId === matchup.eventId ? matchup : row));
      }

      return [...current, matchup];
    });
  }

  function applyMatchupSelection(matchup: MatchupBrowseResult) {
    upsertMatchup(matchup);
    setSelectedMatchupId(matchup.eventId);
    form.setValue('eventName', matchup.eventName, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setSelectedOffer(null);
  }

  function applyBrowseSearchSelection(result: BrowseSearchResult) {
    setLiveEntryMode('search');
    applyMatchupSelection(result.matchup);
    setBrowseSearchQuery(result.displayName);

    if (result.resultType === 'player') {
      if (selectedMarketType !== 'player-prop') {
        setSuspendMarketReset(true);
      }
      setSelectedOfferParticipantId(result.participantId);
      setSelectedPlayerId(result.participantId);
      setSelectedTeamId(result.teamId);
      form.setValue('marketType', 'player-prop', {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      form.setValue('playerName', result.displayName, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      if (result.teamName) {
        form.setValue('team', result.teamName, {
          shouldDirty: true,
          shouldTouch: true,
          shouldValidate: true,
        });
      }
      return;
    }

    setSelectedOfferParticipantId(null);
    setSelectedPlayerId(null);
    form.setValue('playerName', '', {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    if (result.resultType === 'team') {
      setSelectedTeamId(result.teamId ?? result.participantId);
      form.setValue('team', result.displayName, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      return;
    }

    setSelectedTeamId(null);
    form.setValue('team', '', {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  }

  function applyLiveOfferSelection(offer: EventOfferBrowseResult, side: OfferSelectionSide) {
    const derivedMarketType = mapOfferToFormMarketType(offer);
    const nextOdds = side === 'under' ? offer.underOdds : offer.overOdds;
    if (nextOdds == null) {
      return;
    }

    const inferredStatType = inferStatTypeFromMarketTypeId(offer.marketTypeId, offer.marketDisplayName);

    setSelectedOffer({ offer, side });
    if (selectedMarketType !== derivedMarketType) {
      setSuspendMarketReset(true);
    }
    form.setValue('marketType', derivedMarketType, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    form.setValue('eventName', selectedMatchup?.eventName ?? watchedValues.eventName, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    form.setValue('sportsbook', offer.sportsbookId ?? offer.sportsbookName ?? '', {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    form.setValue('odds', nextOdds, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    form.setValue('line', offer.line ?? undefined, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });

    if (derivedMarketType === 'player-prop') {
      form.setValue('playerName', offer.participantName ?? '', {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      form.setValue('statType', inferredStatType ?? '', {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      form.setValue('direction', side === 'under' ? 'under' : 'over', {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      setSelectedPlayerId(offer.participantId);
      setSelectedTeamId(null);
      setSelectedOfferParticipantId(offer.participantId);
      return;
    }

    if (derivedMarketType === 'moneyline' || derivedMarketType === 'spread' || derivedMarketType === 'team-total') {
      form.setValue('team', offer.participantName ?? '', {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      form.setValue(
        'direction',
        derivedMarketType === 'team-total'
          ? side === 'under'
            ? 'under'
            : 'over'
          : undefined,
        {
          shouldDirty: true,
          shouldTouch: true,
          shouldValidate: true,
        },
      );
      setSelectedTeamId(offer.participantId);
      setSelectedPlayerId(null);
      return;
    }

    form.setValue('direction', side === 'under' ? 'under' : 'over', {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setSelectedPlayerId(null);
    setSelectedTeamId(null);
  }

  async function onSubmit(values: BetFormValues) {
    if (!catalog) {
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = buildSubmissionPayload(values, {
        submissionMode: selectedOffer ? 'live-offer' : 'manual',
        eventId: selectedMatchup?.eventId ?? null,
        leagueId: eventBrowse?.leagueId ?? selectedMatchup?.leagueId ?? null,
        teamId: selectedTeamId,
        playerId: selectedPlayerId,
        canonicalMarketTypeId: selectedOffer?.offer.marketTypeId ?? null,
        sportsbookId:
          selectedOffer?.offer.sportsbookId ??
          resolveSportsbookId(catalog, values.sportsbook),
        selectedOffer: selectedOffer?.offer ?? null,
      });
      const result = await submitPick(payload);
      setSubmittedValues(values);
      setSuccessResult(result);
    } catch (err) {
      toast({
        title: 'Submission failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (successResult && submittedValues) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <SuccessReceipt
          result={successResult}
          submittedValues={submittedValues}
          onSubmitAnother={() => {
            setSuccessResult(null);
            setSubmittedValues(null);
            setSelectedMatchupId(null);
            setEventBrowse(null);
            setSelectedOffer(null);
            setSelectedOfferParticipantId(null);
            setSelectedPlayerId(null);
            setSelectedTeamId(null);
            setBrowseMode('live-offer');
            setLiveEntryMode('browse');
            setBrowseSearchQuery('');
            setBrowseSearchResults([]);
            setBrowseSearchError(null);
            setHasSearchedBrowse(false);
            form.reset({
              sport: '',
              eventName: '',
              playerName: '',
              statType: '',
              team: '',
              sportsbook: '',
              capperConviction: undefined,
              gameDate: TODAY,
              units: 1.0,
            });
          }}
        />
      </main>
    );
  }

  if (catalogError) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-destructive text-sm">{catalogError}</div>
      </main>
    );
  }

  if (!catalog) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </main>
    );
  }

  function renderLiveOfferSection() {
    if (browseMode !== 'live-offer' || !selectedSport) {
      return null;
    }

    return (
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Live Slate
            </h2>
            <p className="text-sm text-muted-foreground">
              Browse or search canonical matchups first. Manual entry stays available when coverage is missing.
            </p>
          </div>
          <div
            className={cn(
              'rounded-full px-3 py-1 text-xs font-semibold',
              offerStatus.tone === 'live' && 'bg-emerald-500/15 text-emerald-300',
              offerStatus.tone === 'stale' && 'bg-amber-500/15 text-amber-300',
              offerStatus.tone === 'none' && 'bg-muted text-muted-foreground',
            )}
          >
            {offerStatus.label}
          </div>
        </div>

        <div className="inline-flex rounded-full border border-border bg-background p-1">
          <button
            type="button"
            className={cn(
              'rounded-full px-4 py-2 text-sm font-medium transition-colors',
              liveEntryMode === 'browse'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setLiveEntryMode('browse')}
          >
            Browse slate
          </button>
          <button
            type="button"
            className={cn(
              'rounded-full px-4 py-2 text-sm font-medium transition-colors',
              liveEntryMode === 'search'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setLiveEntryMode('search')}
          >
            Search
          </button>
        </div>

        {liveEntryMode === 'search' ? (
          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Search
              </p>
              <p className="text-sm text-muted-foreground">
                Search canonical players, teams, and matchups for {selectedSport} on {watchedValues.gameDate}.
              </p>
            </div>
            <Input
              value={browseSearchQuery}
              placeholder="Type a player, team, or matchup"
              onChange={(event) => {
                setBrowseSearchQuery(event.target.value);
                setBrowseSearchError(null);
              }}
            />
            {isSearchingBrowse ? (
              <p className="text-sm text-muted-foreground">Searching the live slate...</p>
            ) : null}
            {browseSearchError ? <p className="text-sm text-destructive">{browseSearchError}</p> : null}
            {!isSearchingBrowse && !browseSearchError && hasSearchedBrowse && browseSearchResults.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
                No canonical results matched that search on the selected date. You can switch to browse or finish manually.
              </div>
            ) : null}
            {browseSearchResults.length > 0 ? (
              <div className="grid gap-2">
                {browseSearchResults.map((result) => {
                  const isSelected = result.matchup.eventId === selectedMatchupId;

                  return (
                    <button
                      key={[
                        result.resultType,
                        result.participantId ?? 'matchup',
                        result.matchup.eventId,
                      ].join(':')}
                      type="button"
                      onClick={() => applyBrowseSearchSelection(result)}
                      className={cn(
                        'rounded-xl border px-4 py-3 text-left transition-colors',
                        isSelected
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-card hover:border-primary/50',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">{result.displayName}</p>
                          <p className="text-xs text-muted-foreground">{result.contextLabel}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatMatchup(result.matchup)} · {formatSearchTimestamp(result.matchup.eventDate)}
                          </p>
                        </div>
                        <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground">
                          {buildSearchResultTone(result.resultType)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {liveEntryMode === 'browse' && isLoadingMatchups ? (
          <p className="text-sm text-muted-foreground">Loading matchups...</p>
        ) : null}
        {liveEntryMode === 'browse' && matchupsError ? <p className="text-sm text-destructive">{matchupsError}</p> : null}
        {liveEntryMode === 'browse' && !isLoadingMatchups && !matchupsError && matchups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card px-4 py-5 text-sm text-muted-foreground">
            No matchups scheduled for {watchedValues.gameDate}. You can switch to manual entry and still submit against canonical sport and book selections.
          </div>
        ) : null}
        {liveEntryMode === 'browse' && matchups.length > 0 ? (
          <div className="grid gap-2">
            {matchups.map((matchup) => {
              const isSelected = matchup.eventId === selectedMatchupId;
              return (
                <button
                  key={matchup.eventId}
                  type="button"
                  onClick={() => applyMatchupSelection(matchup)}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-left transition-colors',
                    isSelected
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-card hover:border-primary/50',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{formatMatchup(matchup)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatTimestampLabel(matchup.eventDate)} · {matchup.status}
                      </p>
                    </div>
                    {matchup.leagueId ? (
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {matchup.leagueId}
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}

        {selectedMatchup ? (
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{selectedMatchup.eventName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatTimestampLabel(selectedMatchup.eventDate)}
                </p>
              </div>
              {isLoadingEventBrowse ? (
                <span className="text-xs text-muted-foreground">Loading offers...</span>
              ) : null}
            </div>

            {eventBrowseError ? <p className="text-sm text-destructive">{eventBrowseError}</p> : null}

            {eventBrowse && availableOfferFamilies.length > 0 ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Market Family
                  </p>
                  <MarketTypeGrid
                    availableTypes={availableOfferFamilies}
                    selected={selectedMarketType}
                    onSelect={(type) => form.setValue('marketType', type, {
                      shouldDirty: true,
                      shouldTouch: true,
                      shouldValidate: true,
                    })}
                  />
                </div>

                {selectedMarketType === 'player-prop' && groupedPlayers.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Player
                    </p>
                    <div className="space-y-3">
                      {groupedPlayers.map((group) => (
                        <div key={group.teamName} className="space-y-2">
                          <p className="text-xs text-muted-foreground">{group.teamName}</p>
                          <div className="flex flex-wrap gap-2">
                            {group.players.map((player) => (
                              <Button
                                key={player.participantId}
                                type="button"
                                variant={selectedOfferParticipantId === player.participantId ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => {
                                  setSelectedOfferParticipantId(player.participantId);
                                  setSelectedPlayerId(player.canonicalId ?? player.participantId);
                                  form.setValue('playerName', player.displayName, {
                                    shouldDirty: true,
                                    shouldTouch: true,
                                    shouldValidate: true,
                                  });
                                }}
                              >
                                {player.displayName}
                              </Button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedMarketType ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Offers
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (!selectedMatchupId) {
                            return;
                          }

                          setEventBrowse(null);
                          setSelectedOffer(null);
                          getEventBrowse(selectedMatchupId)
                            .then(setEventBrowse)
                            .catch((error: unknown) => {
                              setEventBrowseError(
                                error instanceof Error ? error.message : 'Unable to refresh offers',
                              );
                            });
                        }}
                      >
                        Refresh
                      </Button>
                    </div>

                    {filteredOffers.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
                        No live offers for this market. The form below is ready for manual completion using the selected canonical matchup.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {filteredOffers.map((offer) => {
                          const offerAgeMinutes = getOfferAgeMinutes(offer.snapshotAt);
                          const isMoneyline = mapOfferToFormMarketType(offer) === 'moneyline';
                          const buttonSides: OfferSelectionSide[] = isMoneyline ? ['side'] : ['over', 'under'];

                          return (
                            <div
                              key={[
                                offer.sportsbookId ?? offer.providerKey,
                                offer.marketTypeId ?? offer.providerMarketKey,
                                offer.participantId ?? 'all',
                                offer.line ?? 'null',
                              ].join(':')}
                              className="rounded-lg border border-border bg-background/70 px-4 py-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-medium text-foreground">
                                    {offer.marketDisplayName}
                                    {offer.participantName ? ` · ${offer.participantName}` : ''}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {offer.sportsbookName ?? offer.providerKey}
                                    {offer.line != null ? ` · Line ${offer.line}` : ''}
                                    {offerAgeMinutes != null ? ` · ${offerAgeMinutes}m old` : ''}
                                  </p>
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {buttonSides.map((side) => (
                                  <OfferButton
                                    key={side}
                                    offer={offer}
                                    side={side}
                                    isSelected={selectedOffer?.offer === offer && selectedOffer.side === side}
                                    onSelect={() => applyLiveOfferSelection(offer, side)}
                                  />
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Choose a market family to browse live offers.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  function renderBetDetailsSection() {
    if (!selectedMarketType) {
      return null;
    }

    if (selectedMarketType === 'player-prop') {
      return (
        <div className="space-y-4">
          <ParticipantAutocompleteField
            form={form}
            name="playerName"
            label="Player Name"
            placeholder="Type a player name"
            searchType="player"
            sport={selectedSport}
            onSuggestionSelected={(suggestion) => setSelectedPlayerId(suggestion.participantId)}
            onManualChange={() => setSelectedPlayerId(null)}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="eventName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Matchup</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Knicks vs Heat" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="statType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stat Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ''}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select stat" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availableStatTypes.map((statType) => (
                        <SelectItem key={statType} value={statType}>
                          {statType}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="direction"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Over / Under</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ''}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Over or Under" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="over">Over</SelectItem>
                      <SelectItem value="under">Under</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="line"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Line</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.5"
                      placeholder="e.g. 24.5"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(event) => field.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
      );
    }

    if (selectedMarketType === 'moneyline') {
      return (
        <div className="space-y-4">
          <FormField
            control={form.control}
            name="eventName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Matchup</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Lakers vs Warriors" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <ParticipantAutocompleteField
            form={form}
            name="team"
            label="Team to Win"
            placeholder="Type a team name"
            searchType="team"
            sport={selectedSport}
            onSuggestionSelected={(suggestion) => setSelectedTeamId(suggestion.participantId)}
            onManualChange={() => setSelectedTeamId(null)}
          />
        </div>
      );
    }

    if (selectedMarketType === 'spread') {
      return (
        <div className="space-y-4">
          <FormField
            control={form.control}
            name="eventName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Matchup</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Lakers vs Warriors" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            <ParticipantAutocompleteField
              form={form}
              name="team"
              label="Team"
              placeholder="Type a team name"
              searchType="team"
              sport={selectedSport}
              onSuggestionSelected={(suggestion) => setSelectedTeamId(suggestion.participantId)}
              onManualChange={() => setSelectedTeamId(null)}
            />
            <FormField
              control={form.control}
              name="line"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Spread</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.5"
                      placeholder="e.g. -3.5"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(event) => field.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
      );
    }

    if (selectedMarketType === 'total') {
      return (
        <div className="space-y-4">
          <FormField
            control={form.control}
            name="eventName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Matchup</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Lakers vs Warriors" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="direction"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Over / Under</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ''}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Over or Under" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="over">Over</SelectItem>
                      <SelectItem value="under">Under</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="line"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Total</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.5"
                      placeholder="e.g. 220.5"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(event) => field.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
      );
    }

    if (selectedMarketType === 'team-total') {
      return (
        <div className="space-y-4">
          <FormField
            control={form.control}
            name="eventName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Matchup</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Lakers vs Warriors" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            <ParticipantAutocompleteField
              form={form}
              name="team"
              label="Team"
              placeholder="Type a team name"
              searchType="team"
              sport={selectedSport}
              onSuggestionSelected={(suggestion) => setSelectedTeamId(suggestion.participantId)}
              onManualChange={() => setSelectedTeamId(null)}
            />
            <FormField
              control={form.control}
              name="direction"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Over / Under</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ''}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Over or Under" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="over">Over</SelectItem>
                      <SelectItem value="under">Under</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="line"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Team Total</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.5"
                    placeholder="e.g. 112.5"
                    {...field}
                    value={field.value ?? ''}
                    onChange={(event) => field.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      );
    }

    return null;
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 lg:flex-row lg:items-start">
        <div className="w-full space-y-6 lg:max-w-3xl">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              Smart Form V1
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Live-offer first pick entry
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
              Browse the live slate by date and sport, lock in an available offer when coverage exists,
              or finish the ticket manually against canonical matchup, player, team, and book data.
            </p>
          </div>

          <Form {...form}>
            <form
              className="space-y-6"
              onSubmit={form.handleSubmit(onSubmit)}
            >
              <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Browse Setup</h2>
                    <p className="text-sm text-muted-foreground">
                      Start with the live board. Switch to manual only when the exact offer is missing.
                    </p>
                  </div>
                  <div className="inline-flex rounded-full border border-border bg-background p-1">
                    <button
                      type="button"
                      className={cn(
                        'rounded-full px-4 py-2 text-sm font-medium transition-colors',
                        browseMode === 'live-offer'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                      onClick={() => setBrowseMode('live-offer')}
                    >
                      Live offer mode
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'rounded-full px-4 py-2 text-sm font-medium transition-colors',
                        browseMode === 'manual'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                      onClick={() => setBrowseMode('manual')}
                    >
                      Manual fallback
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="sport"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sport</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value ?? ''}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select sport" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {catalog.sports.map((sport: SportDefinition) => (
                              <SelectItem key={sport.id} value={sport.id}>
                                {sport.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="gameDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} value={field.value ?? TODAY} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </section>

              {renderLiveOfferSection()}

              <section className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-foreground">Pick Details</h2>
                    <span className="text-xs text-muted-foreground">
                      {shouldShowManualFallback ? 'Manual completion active' : 'Offer-backed fields active'}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Market, player or team, and line details remain editable so the capper can finish the ticket
                    even when live coverage is incomplete.
                  </p>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Market Family
                  </p>
                  <MarketTypeGrid
                    availableTypes={selectedMatchup && availableOfferFamilies.length > 0 ? availableOfferFamilies : availableMarketTypes}
                    selected={selectedMarketType}
                    onSelect={(type) => form.setValue('marketType', type, {
                      shouldDirty: true,
                      shouldTouch: true,
                      shouldValidate: true,
                    })}
                  />
                </div>

                {selectedMatchup && shouldShowManualFallback ? (
                  <div className="rounded-xl border border-dashed border-border bg-background/60 px-4 py-3 text-sm text-muted-foreground">
                    The selected matchup is preserved from canonical browse data. You can finish this pick manually if the exact live offer is not present.
                  </div>
                ) : null}

                {!selectedMatchup && browseMode === 'manual' ? (
                  <div className="rounded-xl border border-dashed border-border bg-background/60 px-4 py-3 text-sm text-muted-foreground">
                    Manual fallback is active without a canonical matchup selection. Event entry is free-text until browse selection is made.
                  </div>
                ) : null}

                {renderBetDetailsSection()}
              </section>

              <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-foreground">Book, Odds, and Submission</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="sportsbook"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sportsbook</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value ?? ''}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select sportsbook" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {catalog.sportsbooks.map((sportsbook: SportsbookDefinition) => (
                              <SelectItem key={sportsbook.id} value={sportsbook.id}>
                                {sportsbook.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="odds"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Odds</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="1"
                            placeholder="e.g. -110"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(event) => field.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="units"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Units</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.5"
                            min="0.5"
                            max="5"
                            placeholder="1.0"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(event) => field.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="capperConviction"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Conviction (1-10)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="1"
                            min="1"
                            max="10"
                            placeholder="8"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(event) => field.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          How confident are you in this pick? (1 = low, 10 = highest conviction)
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="capper"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Capper</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value ?? ''}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select capper" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {catalog.cappers.map((capper: string) => (
                              <SelectItem key={capper} value={capper}>
                                {capper}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </section>
            </form>
          </Form>
        </div>

        <div className="w-full lg:max-w-sm">
          <BetSlipPanel
            values={watchedValues}
            isSubmitting={isSubmitting}
            onSubmit={() => void form.handleSubmit(onSubmit)()}
          />
        </div>
      </div>

      <div className="h-20 lg:hidden" />
      <Separator className="sr-only" />
    </main>
  );
}
