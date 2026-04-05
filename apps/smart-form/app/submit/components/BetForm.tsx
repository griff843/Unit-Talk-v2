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
import type { CapperDefinition, CatalogData, SportDefinition, SportsbookDefinition } from '@/lib/catalog';
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
const DEFAULT_OPERATOR_SPORTSBOOK_ID = 'fanatics';

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
  eventId?: string | null;
  sport: string;
  allowedParticipantIds?: ReadonlySet<string> | null;
  onSuggestionSelected: (suggestion: ParticipantSuggestion) => void | Promise<void>;
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoString)) {
    const [year, month, day] = isoString.split('-').map((value) => Number.parseInt(value, 10));
    const dateOnly = new Date(year, (month ?? 1) - 1, day ?? 1);
    return dateOnly.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    });
  }

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
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoString)) {
    const [year, month, day] = isoString.split('-').map((value) => Number.parseInt(value, 10));
    const dateOnly = new Date(year, (month ?? 1) - 1, day ?? 1);
    return dateOnly.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    });
  }

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

function normalizeParticipantKey(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? null;
}

function teamMatchesMatchup(matchup: MatchupBrowseResult, teamId: string | null | undefined) {
  if (!teamId) {
    return false;
  }

  const normalizedTeamId = teamId.trim().toLocaleLowerCase();
  return matchup.teams.some((team) => {
    const canonicalTeamId = team.teamId?.trim().toLocaleLowerCase();
    const participantTeamId = team.participantId.trim().toLocaleLowerCase();
    return canonicalTeamId === normalizedTeamId || participantTeamId === normalizedTeamId;
  });
}

function offerMatchesSelectedSportsbook(
  offer: EventOfferBrowseResult,
  sportsbookValue: string | null | undefined,
) {
  const normalizedSportsbook = sportsbookValue?.trim().toLocaleLowerCase() ?? '';
  if (normalizedSportsbook.length === 0) {
    return true;
  }

  return normalizedSportsbook === (offer.sportsbookId ?? '').trim().toLocaleLowerCase() ||
    normalizedSportsbook === (offer.sportsbookName ?? '').trim().toLocaleLowerCase();
}

function buildOddsLabel(odds: number | null | undefined) {
  if (odds == null) {
    return 'Manual odds';
  }

  return odds > 0 ? `+${odds}` : `${odds}`;
}

function formatLineLabel(line: number | null | undefined) {
  if (line == null) {
    return null;
  }

  return line > 0 ? `+${line}` : `${line}`;
}

function parseOptionalNumber(value: string) {
  if (value.trim() === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeUnitsValue(value: string) {
  const parsed = parseOptionalNumber(value);
  if (parsed == null) {
    return undefined;
  }

  return clampNumber(Math.round(parsed * 2) / 2, 0.5, 5);
}

function normalizeConvictionValue(value: string) {
  const parsed = parseOptionalNumber(value);
  if (parsed == null) {
    return undefined;
  }

  return clampNumber(Math.round(parsed), 1, 10);
}

function ParticipantAutocompleteField({
  form,
  name,
  label,
  placeholder,
  searchType,
  eventId,
  sport,
  allowedParticipantIds,
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
        const response = await fetch(buildParticipantSearchUrl(query, searchType, { sport, eventId }), {
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

        const normalizedSuggestions = normalizeParticipantSearchResults(
          isRecord(json) ? json : { data: [] },
          searchType,
        );
        setSuggestions(
          allowedParticipantIds && allowedParticipantIds.size > 0
            ? normalizedSuggestions.filter((suggestion) => allowedParticipantIds.has(suggestion.participantId))
            : normalizedSuggestions,
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
  }, [allowedParticipantIds, eventId, name, searchType, sport, value]);

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
              disabled={!sport}
              placeholder={sport ? placeholder : 'Select a sport first'}
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
          {!sport ? (
            <p className="text-xs text-muted-foreground">
              Select a sport before searching canonical participants.
            </p>
          ) : null}
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

function SearchableCapperField({
  form,
  cappers,
}: {
  form: UseFormReturn<BetFormValues>;
  cappers: CapperDefinition[];
}) {
  const selectedCapperId = useWatch({ control: form.control, name: 'capper' }) ?? '';
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const selectedCapper = useMemo(
    () => cappers.find((capper) => capper.id === selectedCapperId) ?? null,
    [cappers, selectedCapperId],
  );
  const filteredCappers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (normalizedQuery.length === 0) {
      return cappers;
    }

    return cappers.filter((capper) => {
      const displayName = capper.displayName.toLocaleLowerCase();
      const canonicalId = capper.id.toLocaleLowerCase();
      return displayName.includes(normalizedQuery) || canonicalId.includes(normalizedQuery);
    });
  }, [cappers, query]);

  useEffect(() => {
    if (!isFocused) {
      setQuery(selectedCapper?.displayName ?? '');
    }
  }, [isFocused, selectedCapper]);

  return (
    <FormField
      control={form.control}
      name="capper"
      render={({ field }) => (
        <FormItem className="relative">
          <FormLabel>Capper</FormLabel>
          <FormControl>
            <Input
              autoComplete="off"
              placeholder="Search capper"
              value={query}
              onFocus={() => setIsFocused(true)}
              onBlur={() => {
                window.setTimeout(() => {
                  setIsFocused(false);
                  setQuery(selectedCapper?.displayName ?? '');
                }, 120);
              }}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                if (field.value) {
                  form.setValue('capper', '', {
                    shouldDirty: true,
                    shouldTouch: true,
                    shouldValidate: false,
                  });
                }
              }}
            />
          </FormControl>
          {isFocused ? (
            <div className="absolute inset-x-0 top-full z-20 mt-2 max-h-64 overflow-y-auto rounded-md border border-border bg-background shadow-lg">
              {filteredCappers.length > 0 ? (
                <div className="py-1">
                  {filteredCappers.map((capper) => (
                    <button
                      key={capper.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        field.onChange(capper.id);
                        setQuery(capper.displayName);
                        setIsFocused(false);
                        form.clearErrors('capper');
                      }}
                    >
                      <span>{capper.displayName}</span>
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {capper.id}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  No matching cappers found.
                </div>
              )}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Search by display name or canonical id. Submissions persist the selected capper id.
          </p>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function SearchableSportsbookField({
  form,
  sportsbooks,
}: {
  form: UseFormReturn<BetFormValues>;
  sportsbooks: SportsbookDefinition[];
}) {
  const selectedSportsbookValue = useWatch({ control: form.control, name: 'sportsbook' }) ?? '';
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);

  const selectedSportsbook = useMemo(
    () =>
      sportsbooks.find(
        (sportsbook) =>
          sportsbook.id === selectedSportsbookValue ||
          sportsbook.name.toLocaleLowerCase() === selectedSportsbookValue.toLocaleLowerCase(),
      ) ?? null,
    [sportsbooks, selectedSportsbookValue],
  );
  const filteredSportsbooks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (normalizedQuery.length === 0) {
      return sportsbooks;
    }

    return sportsbooks.filter((sportsbook) => {
      const displayName = sportsbook.name.toLocaleLowerCase();
      const canonicalId = sportsbook.id.toLocaleLowerCase();
      return displayName.includes(normalizedQuery) || canonicalId.includes(normalizedQuery);
    });
  }, [sportsbooks, query]);

  useEffect(() => {
    if (selectedSportsbookValue && !selectedSportsbook) {
      setManualEntry(true);
      return;
    }

    if (selectedSportsbook) {
      setManualEntry(false);
    }
  }, [selectedSportsbook, selectedSportsbookValue]);

  useEffect(() => {
    if (!isFocused) {
      setQuery(selectedSportsbook?.name ?? (manualEntry ? selectedSportsbookValue : ''));
    }
  }, [isFocused, manualEntry, selectedSportsbook, selectedSportsbookValue]);

  return (
    <FormField
      control={form.control}
      name="sportsbook"
      render={({ field }) => (
        <FormItem className="relative">
          <div className="flex items-center justify-between gap-3">
            <FormLabel>Sportsbook</FormLabel>
            <button
              type="button"
              className="text-[11px] font-semibold uppercase tracking-wider text-primary transition-colors hover:text-primary/80"
              onClick={() => {
                setManualEntry((current) => !current);
                if (!manualEntry) {
                  setQuery(field.value ?? '');
                } else {
                  setQuery(selectedSportsbook?.name ?? '');
                }
              }}
            >
              {manualEntry ? 'Use catalog list' : 'Book not listed? Type it'}
            </button>
          </div>
          <FormControl>
            <Input
              autoComplete="off"
              placeholder={manualEntry ? 'Type sportsbook name' : 'Search sportsbook'}
              value={manualEntry ? field.value ?? '' : isFocused ? query : (selectedSportsbook?.name ?? query)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => {
                window.setTimeout(() => {
                  setIsFocused(false);
                  setQuery(selectedSportsbook?.name ?? (manualEntry ? field.value ?? '' : ''));
                }, 120);
              }}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (manualEntry) {
                  field.onChange(nextValue);
                  return;
                }

                setQuery(nextValue);
                if (field.value) {
                  form.setValue('sportsbook', '', {
                    shouldDirty: true,
                    shouldTouch: true,
                    shouldValidate: false,
                  });
                }
              }}
            />
          </FormControl>
          {!manualEntry && isFocused ? (
            <div className="absolute inset-x-0 top-full z-20 mt-2 max-h-64 overflow-y-auto rounded-md border border-border bg-background shadow-lg">
              {filteredSportsbooks.length > 0 ? (
                <div className="py-1">
                  {filteredSportsbooks.map((sportsbook) => (
                    <button
                      key={sportsbook.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        field.onChange(sportsbook.id);
                        setQuery(sportsbook.name);
                        setIsFocused(false);
                        form.clearErrors('sportsbook');
                      }}
                    >
                      <span>{sportsbook.name}</span>
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {sportsbook.id}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  No matching books found. Use manual entry to type the book.
                </div>
              )}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {manualEntry
              ? 'Manual sportsbook entry is allowed when the canonical list is missing a book. The typed value is preserved for operator review.'
              : 'Search the canonical sportsbook list. Fanatics is included; provider-only books are hidden from operator entry.'}
          </p>
          <FormMessage />
        </FormItem>
      )}
    />
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
      sportsbook: DEFAULT_OPERATOR_SPORTSBOOK_ID,
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
  const selectedSportsbookValue = watchedValues.sportsbook?.trim().toLocaleLowerCase() ?? '';
  const emptyCatalog: CatalogData = { sports: [], sportsbooks: [], ticketTypes: [], cappers: [] };
  const selectedCatalogSportsbook = useMemo(
    () => catalog?.sportsbooks.find((sportsbook) => (
      sportsbook.id === selectedSportsbookValue ||
      sportsbook.name.toLocaleLowerCase() === selectedSportsbookValue
    )) ?? null,
    [catalog, selectedSportsbookValue],
  );
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
  const allowedPlayerIds = useMemo(() => {
    if (!eventBrowse) {
      return null;
    }
    return new Set(
      eventBrowse.participants
        .filter((participant) => participant.participantType === 'player')
        .filter((participant) => !selectedTeamId || participant.teamId === selectedTeamId)
        .map((participant) => participant.participantId),
    );
  }, [eventBrowse, selectedTeamId]);
  const allowedTeamIds = useMemo(() => {
    if (!eventBrowse) {
      return null;
    }
    return new Set(
      eventBrowse.participants
        .filter((participant) => participant.participantType === 'team')
        .map((participant) => participant.participantId),
    );
  }, [eventBrowse]);
  const availableOfferFamilies = useMemo(() => {
    if (!eventBrowse) {
      return [] as MarketTypeId[];
    }

    return Array.from(
      new Set(eventBrowse.offers.map((offer) => mapOfferToFormMarketType(offer))),
    );
  }, [eventBrowse]);
  const visibleMarketFamilies = useMemo(
    () => Array.from(new Set([...availableMarketTypes, ...availableOfferFamilies])),
    [availableMarketTypes, availableOfferFamilies],
  );
  const groupedPlayers = useMemo(() => {
    if (!eventBrowse) {
      return [] as Array<{
        teamName: string;
        players: EventBrowseResult['participants'];
      }>;
    }

    const playerParticipants = eventBrowse.participants
      .filter((participant) => participant.participantType === 'player')
      .filter((participant) => !selectedTeamId || participant.teamId === selectedTeamId)
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
  }, [eventBrowse, selectedTeamId]);
  const filteredOffers = useMemo(() => {
    if (!eventBrowse || !selectedMarketType) {
      return [] as EventOfferBrowseResult[];
    }

    return eventBrowse.offers.filter((offer) => {
      if (mapOfferToFormMarketType(offer) !== selectedMarketType) {
        return false;
      }
      if (selectedCatalogSportsbook && !offerMatchesSelectedSportsbook(offer, selectedSportsbookValue)) {
        return false;
      }
      if (
        selectedMarketType === 'player-prop' &&
        watchedValues.statType &&
        inferStatTypeFromMarketTypeId(offer.marketTypeId, offer.marketDisplayName) !== watchedValues.statType
      ) {
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
  }, [eventBrowse, selectedCatalogSportsbook, selectedMarketType, selectedOfferParticipantId, selectedSportsbookValue, watchedValues.statType]);
  const matchupTeams = useMemo(
    () => [...(selectedMatchup?.teams ?? [])].sort(
      (left, right) => roleSortOrder(left.role) - roleSortOrder(right.role),
    ),
    [selectedMatchup],
  );
  const moneylineOfferMap = useMemo(() => {
    const offers = new Map<string, EventOfferBrowseResult>();
    if (!eventBrowse || selectedMarketType !== 'moneyline') {
      return offers;
    }

    for (const offer of filteredOffers) {
      const eventParticipant = eventBrowse.participants.find((participant) => (
        participant.participantType === 'team' &&
        (
          participant.participantId === offer.participantId ||
          participant.canonicalId === offer.participantId ||
          normalizeParticipantKey(participant.displayName) === normalizeParticipantKey(offer.participantName) ||
          normalizeParticipantKey(participant.displayName) === normalizeParticipantKey(offer.providerParticipantId)
        )
      ));

      const possibleKeys = [
        offer.participantId,
        eventParticipant?.participantId,
        eventParticipant?.canonicalId,
      ].filter((value): value is string => Boolean(value));

      for (const key of possibleKeys) {
        offers.set(key, offer);
      }
    }

    return offers;
  }, [eventBrowse, filteredOffers, selectedMarketType]);
  const spreadOffers = useMemo(
    () => selectedMarketType === 'spread'
      ? filteredOffers.filter((offer) => offer.overOdds != null)
      : [],
    [filteredOffers, selectedMarketType],
  );
  const totalOffers = useMemo(
    () => selectedMarketType === 'total' ? filteredOffers : [],
    [filteredOffers, selectedMarketType],
  );
  const availablePlayerPropStatTypes = useMemo(() => {
    if (selectedMarketType !== 'player-prop') {
      return [] as string[];
    }
    if (!eventBrowse) {
      return availableStatTypes;
    }

    const inferredStatTypes = Array.from(
      new Set(
        eventBrowse.offers
          .filter((offer) => mapOfferToFormMarketType(offer) === 'player-prop')
          .filter((offer) => !selectedOfferParticipantId || offer.participantId === selectedOfferParticipantId)
          .flatMap((offer) => {
            const statType = inferStatTypeFromMarketTypeId(offer.marketTypeId, offer.marketDisplayName);
            return statType ? [statType] : [];
          }),
      ),
    );

    if (inferredStatTypes.length === 0) {
      return availableStatTypes;
    }

    return [
      ...availableStatTypes.filter((statType) => inferredStatTypes.includes(statType)),
      ...inferredStatTypes.filter((statType) => !availableStatTypes.includes(statType)),
    ];
  }, [availableStatTypes, eventBrowse, selectedMarketType, selectedOfferParticipantId]);
  const offerStatus = buildOfferStatus(eventBrowse);
  const hasInlineGuidedMarket =
    browseMode === 'live-offer' &&
    Boolean(selectedMatchup) &&
    (
      selectedMarketType === 'moneyline' ||
      selectedMarketType === 'player-prop' ||
      ((selectedMarketType === 'spread' || selectedMarketType === 'total') && filteredOffers.length > 0)
    );
  const hasSelectedBrowseMatchup = browseMode === 'live-offer' && Boolean(selectedMatchup);
  const shouldShowManualFallback =
    browseMode === 'manual' ||
    !selectedMatchup ||
    !eventBrowse ||
    filteredOffers.length === 0;
  const shouldRenderPickDetailsSection =
    browseMode === 'manual' ||
    !selectedMatchup ||
    (shouldShowManualFallback && !hasInlineGuidedMarket);

  useEffect(() => {
    getCatalog()
      .then(setCatalog)
      .catch((err: unknown) => setCatalogError(err instanceof Error ? err.message : 'Reference data unavailable'));
  }, []);

  // Prefer Griff843 as the default capper for operator submissions; otherwise fall back to a single known capper.
  useEffect(() => {
    if (!catalog || form.getValues('capper')) {
      return;
    }

    const preferredCapper = catalog.cappers.find((capper) => capper.id === 'griff843');
    const fallbackCapper = preferredCapper ?? (catalog.cappers.length === 1 ? catalog.cappers[0] : null);
    if (fallbackCapper) {
      form.setValue('capper', fallbackCapper.id, { shouldValidate: true });
    }
  }, [catalog, form]);

  useEffect(() => {
    if (!catalog || form.getValues('sportsbook')) {
      return;
    }

    const defaultSportsbook = catalog.sportsbooks.find((sportsbook) => sportsbook.id === DEFAULT_OPERATOR_SPORTSBOOK_ID);
    if (!defaultSportsbook) {
      return;
    }

    form.setValue('sportsbook', defaultSportsbook.id, { shouldValidate: true });
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
    form.setValue('sportsbook', DEFAULT_OPERATOR_SPORTSBOOK_ID);
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

  useEffect(() => {
    if (
      selectedMarketType === 'player-prop' &&
      watchedValues.statType &&
      !availablePlayerPropStatTypes.includes(watchedValues.statType)
    ) {
      form.setValue('statType', '', {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
    }
  }, [availablePlayerPropStatTypes, form, selectedMarketType, watchedValues.statType]);

  useEffect(() => {
    if (
      !selectedOffer ||
      !selectedCatalogSportsbook ||
      offerMatchesSelectedSportsbook(selectedOffer.offer, selectedSportsbookValue)
    ) {
      return;
    }

    setSelectedOffer(null);
    form.resetField('odds');
  }, [form, selectedCatalogSportsbook, selectedOffer, selectedSportsbookValue]);

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
    setSelectedOffer(null);
    setSelectedOfferParticipantId(null);
    setSelectedPlayerId(null);
    setSelectedTeamId(null);
    form.setValue('eventName', matchup.eventName, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    form.setValue('playerName', '', {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: false,
    });
    form.setValue('statType', '', {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: false,
    });
    form.setValue('team', '', {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: false,
    });
    form.resetField('direction');
    form.resetField('line');
    form.resetField('odds');
    form.clearErrors('eventName');
  }

  function clearSelectedMatchup() {
    setSelectedMatchupId(null);
    setEventBrowse(null);
    setEventBrowseError(null);
    setSelectedOffer(null);
    setSelectedOfferParticipantId(null);
    setSelectedPlayerId(null);
    setSelectedTeamId(null);
    form.setValue('eventName', '', {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: false,
    });
    form.setValue('playerName', '', {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: false,
    });
    form.setValue('statType', '', {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: false,
    });
    form.setValue('team', '', {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: false,
    });
    form.resetField('direction');
    form.resetField('line');
    form.resetField('odds');
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

  function findUniqueMatchupForTeam(teamId: string | null | undefined) {
    if (!teamId) {
      return null;
    }

    const matchingMatchups = matchups.filter((matchup) => teamMatchesMatchup(matchup, teamId));
    return matchingMatchups.length === 1 ? matchingMatchups[0] ?? null : null;
  }

  async function resolveBrowseResultForSelection(
    displayName: string,
    resultType: BrowseSearchResult['resultType'],
    participantId?: string | null,
  ) {
    if (!selectedSport || !watchedValues.gameDate) {
      return null;
    }

    const results = await searchBrowse(selectedSport, watchedValues.gameDate, displayName);
    const exactResults = results.filter((result) => {
      if (result.resultType !== resultType) {
        return false;
      }

      if (participantId && result.participantId === participantId) {
        return true;
      }

      return normalizeParticipantKey(result.displayName) === normalizeParticipantKey(displayName);
    });

    if (exactResults.length === 1) {
      return exactResults[0] ?? null;
    }

    const uniqueMatchupIds = Array.from(new Set(exactResults.map((result) => result.matchup.eventId)));
    return uniqueMatchupIds.length === 1 ? (exactResults[0] ?? null) : null;
  }

  async function handlePlayerSuggestionSelection(suggestion: ParticipantSuggestion) {
    setSelectedPlayerId(suggestion.participantId);
    setSelectedOfferParticipantId(suggestion.participantId);

    const browseResult = await resolveBrowseResultForSelection(
      suggestion.displayName,
      'player',
      suggestion.participantId,
    );

    if (!browseResult) {
      return;
    }

    applyMatchupSelection(browseResult.matchup);
    setSelectedPlayerId(browseResult.participantId ?? suggestion.participantId);
    setSelectedOfferParticipantId(browseResult.participantId ?? suggestion.participantId);
    setSelectedTeamId(browseResult.teamId);
    form.setValue('playerName', browseResult.displayName, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    if (browseResult.teamName) {
      form.setValue('team', browseResult.teamName, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
    }
  }

  async function handleTeamSuggestionSelection(suggestion: ParticipantSuggestion) {
    setSelectedTeamId(suggestion.participantId);

    const uniqueMatchupFromSlate = findUniqueMatchupForTeam(suggestion.participantId);
    if (uniqueMatchupFromSlate) {
      applyMatchupSelection(uniqueMatchupFromSlate);
      setSelectedTeamId(suggestion.participantId);
      return;
    }

    const browseResult = await resolveBrowseResultForSelection(
      suggestion.displayName,
      'team',
      suggestion.participantId,
    );

    if (!browseResult) {
      return;
    }

    applyMatchupSelection(browseResult.matchup);
    setSelectedTeamId(browseResult.teamId ?? suggestion.participantId);
  }

  function applyLiveOfferSelection(offer: EventOfferBrowseResult, side: OfferSelectionSide) {
    const derivedMarketType = mapOfferToFormMarketType(offer);
    const nextOdds = side === 'under' ? offer.underOdds : offer.overOdds;
    if (nextOdds == null) {
      return;
    }

    const inferredStatType = inferStatTypeFromMarketTypeId(offer.marketTypeId, offer.marketDisplayName);
    const resolvedTeamParticipantId =
      offer.participantId ??
      eventBrowse?.participants.find((participant) => (
        participant.participantType === 'team' &&
        normalizeParticipantKey(participant.displayName) ===
          normalizeParticipantKey(offer.providerParticipantId)
      ))?.participantId ??
      offer.providerParticipantId;

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
      setSelectedTeamId(resolvedTeamParticipantId);
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

  function applyMoneylineTeamSelection(team: MatchupBrowseResult['teams'][number]) {
    form.setValue('team', team.displayName, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setSelectedTeamId(team.teamId ?? team.participantId);
    form.clearErrors('team');

    const matchingOffer = moneylineOfferMap.get(team.teamId ?? '') ??
      moneylineOfferMap.get(team.participantId);

    if (matchingOffer) {
      applyLiveOfferSelection(matchingOffer, 'side');
      return;
    }

    setSelectedOffer(null);
    form.resetField('odds');
  }

  async function onSubmit(values: BetFormValues) {
    if (!catalog) {
      return;
    }

    setIsSubmitting(true);
    try {
      const submittedSportsbook = values.sportsbook ?? '';
      const normalizedSubmittedSportsbook = submittedSportsbook.trim().toLocaleLowerCase();
      const selectedOfferMatchesSubmittedBook = selectedOffer
        ? normalizedSubmittedSportsbook.length === 0 ||
          normalizedSubmittedSportsbook === (selectedOffer.offer.sportsbookId ?? '').toLocaleLowerCase() ||
          normalizedSubmittedSportsbook === (selectedOffer.offer.sportsbookName ?? '').toLocaleLowerCase()
        : false;
      const resolvedSportsbookId = selectedOfferMatchesSubmittedBook
        ? (selectedOffer?.offer.sportsbookId ?? resolveSportsbookId(catalog, values.sportsbook))
        : resolveSportsbookId(catalog, values.sportsbook);

      const payload = buildSubmissionPayload(values, {
        submissionMode: selectedOffer ? 'live-offer' : 'manual',
        eventId: selectedMatchup?.eventId ?? null,
        leagueId: eventBrowse?.leagueId ?? selectedMatchup?.leagueId ?? null,
        teamId: selectedTeamId,
        playerId: selectedPlayerId,
        canonicalMarketTypeId: selectedOffer?.offer.marketTypeId ?? null,
        sportsbookId: resolvedSportsbookId,
        manualOverrideFields:
          values.sportsbook && !resolvedSportsbookId
            ? ['sportsbook']
            : [],
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
              sportsbook: DEFAULT_OPERATOR_SPORTSBOOK_ID,
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
              <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">
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
        {liveEntryMode === 'browse' && matchups.length > 0 && !selectedMatchup ? (
          <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">
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
              <div className="flex items-center gap-2">
                {isLoadingEventBrowse ? (
                  <span className="text-xs text-muted-foreground">Loading offers...</span>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearSelectedMatchup}
                >
                  Change game
                </Button>
              </div>
            </div>

            {eventBrowseError ? <p className="text-sm text-destructive">{eventBrowseError}</p> : null}

            {eventBrowse && availableOfferFamilies.length > 0 ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Market Family
                  </p>
                  <MarketTypeGrid
                    availableTypes={visibleMarketFamilies}
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
                    <div className="grid gap-3 md:grid-cols-3">
                      <ParticipantAutocompleteField
                        form={form}
                        name="team"
                        label="Team"
                        placeholder="Type a team name"
                        searchType="team"
                        eventId={selectedMatchupId}
                        sport={selectedSport}
                        allowedParticipantIds={allowedTeamIds}
                        onSuggestionSelected={handleTeamSuggestionSelection}
                        onManualChange={() => setSelectedTeamId(null)}
                      />
                      <ParticipantAutocompleteField
                        form={form}
                        name="playerName"
                        label="Player"
                        placeholder="Type a player name"
                        searchType="player"
                        eventId={selectedMatchupId}
                        sport={selectedSport}
                        allowedParticipantIds={allowedPlayerIds}
                        onSuggestionSelected={handlePlayerSuggestionSelection}
                        onManualChange={() => setSelectedPlayerId(null)}
                      />
                      <FormField
                        control={form.control}
                        name="statType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Stat Type</FormLabel>
                            <Select
                              disabled={availablePlayerPropStatTypes.length === 0}
                              onValueChange={field.onChange}
                              value={field.value ?? ''}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select stat" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {availablePlayerPropStatTypes.map((statType) => (
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
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Player
                    </p>
                    <div className="max-h-52 space-y-3 overflow-y-auto pr-1">
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

                {selectedMarketType === 'moneyline' && matchupTeams.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Team to Win
                      </p>
                      <span className="text-xs text-muted-foreground">
                        {selectedSportsbookValue ? 'Odds filtered by sportsbook' : 'Select a sportsbook to lock odds'}
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {matchupTeams.map((team) => {
                        const offer = moneylineOfferMap.get(team.teamId ?? '') ?? moneylineOfferMap.get(team.participantId);
                        const isSelected = selectedTeamId === (team.teamId ?? team.participantId);
                        return (
                          <button
                            key={team.participantId}
                            type="button"
                            onClick={() => applyMoneylineTeamSelection(team)}
                            className={cn(
                              'rounded-xl border px-4 py-4 text-left transition-colors',
                              isSelected
                                ? 'border-primary bg-primary/10'
                                : 'border-border bg-background hover:border-primary/50',
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-foreground">{team.displayName}</p>
                                <p className="text-xs text-muted-foreground">
                                  {offer?.sportsbookName ?? (selectedSportsbookValue ? watchedValues.sportsbook : 'Manual fallback')}
                                </p>
                              </div>
                              <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-foreground">
                                {buildOddsLabel(offer?.overOdds)}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {selectedMarketType === 'spread' && spreadOffers.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Spread
                      </p>
                      <span className="text-xs text-muted-foreground">
                        Tap the side to preload line and odds
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {spreadOffers.map((offer) => {
                        const teamKey = offer.participantId ?? offer.providerParticipantId ?? offer.participantName ?? offer.marketDisplayName;
                        const isSelected =
                          selectedOffer?.offer === offer ||
                          normalizeParticipantKey(watchedValues.team) === normalizeParticipantKey(offer.participantName);
                        return (
                          <button
                            key={`${teamKey}:${offer.line ?? 'line'}`}
                            type="button"
                            onClick={() => applyLiveOfferSelection(offer, 'side')}
                            className={cn(
                              'rounded-xl border px-4 py-4 text-left transition-colors',
                              isSelected
                                ? 'border-primary bg-primary/10'
                                : 'border-border bg-background hover:border-primary/50',
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-foreground">{offer.participantName ?? 'Team'}</p>
                                <p className="text-xs text-muted-foreground">
                                  {offer.sportsbookName ?? (selectedSportsbookValue ? watchedValues.sportsbook : 'Live offer')}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-semibold text-foreground">
                                  {formatLineLabel(offer.line) ?? 'Line pending'}
                                </p>
                                <p className="text-xs text-muted-foreground">{buildOddsLabel(offer.overOdds)}</p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {selectedMarketType === 'total' && totalOffers.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Total
                      </p>
                      <span className="text-xs text-muted-foreground">
                        Tap over or under to preload the total
                      </span>
                    </div>
                    <div className="space-y-2">
                      {totalOffers.map((offer) => (
                        <div
                          key={`${offer.marketTypeId ?? offer.providerMarketKey}:${offer.line ?? 'line'}`}
                          className="rounded-xl border border-border bg-background px-4 py-4"
                        >
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <p className="font-semibold text-foreground">Game Total</p>
                              <p className="text-xs text-muted-foreground">
                                {offer.sportsbookName ?? (selectedSportsbookValue ? watchedValues.sportsbook : 'Live offer')}
                              </p>
                            </div>
                            <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-foreground">
                              {offer.line != null ? String(offer.line) : 'Line pending'}
                            </span>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Button
                              type="button"
                              variant={selectedOffer?.offer === offer && selectedOffer.side === 'over' ? 'default' : 'outline'}
                              className="justify-between"
                              onClick={() => applyLiveOfferSelection(offer, 'over')}
                            >
                              <span>Over</span>
                              <span>{buildOddsLabel(offer.overOdds)}</span>
                            </Button>
                            <Button
                              type="button"
                              variant={selectedOffer?.offer === offer && selectedOffer.side === 'under' ? 'default' : 'outline'}
                              className="justify-between"
                              onClick={() => applyLiveOfferSelection(offer, 'under')}
                            >
                              <span>Under</span>
                              <span>{buildOddsLabel(offer.underOdds)}</span>
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedMarketType === 'player-prop' && filteredOffers.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Player Prop Offers
                      </p>
                      <span className="text-xs text-muted-foreground">
                        Tap over or under to preload the prop
                      </span>
                    </div>
                    <div className="max-h-[24rem] space-y-2 overflow-y-auto pr-1">
                      {filteredOffers.map((offer) => {
                        const statLabel =
                          inferStatTypeFromMarketTypeId(offer.marketTypeId, offer.marketDisplayName) ??
                          watchedValues.statType ??
                          'Prop';
                        const lineLabel = offer.line != null ? String(offer.line) : 'Line pending';
                        const participantLabel = offer.participantName ?? watchedValues.playerName ?? 'Player';
                        return (
                          <div
                            key={[
                              offer.sportsbookId ?? offer.providerKey,
                              offer.marketTypeId ?? offer.providerMarketKey,
                              offer.participantId ?? 'participant',
                              offer.line ?? 'line',
                            ].join(':')}
                            className="rounded-xl border border-border bg-background px-4 py-4"
                          >
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div>
                                <p className="font-semibold text-foreground">{participantLabel}</p>
                                <p className="text-xs text-muted-foreground">
                                  {statLabel}
                                  {offer.sportsbookName ?? (selectedSportsbookValue ? ` · ${watchedValues.sportsbook}` : '')}
                                </p>
                              </div>
                              <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-foreground">
                                {lineLabel}
                              </span>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <Button
                                type="button"
                                variant={selectedOffer?.offer === offer && selectedOffer.side === 'over' ? 'default' : 'outline'}
                                className="justify-between"
                                onClick={() => applyLiveOfferSelection(offer, 'over')}
                              >
                                <span>Over</span>
                                <span>{buildOddsLabel(offer.overOdds)}</span>
                              </Button>
                              <Button
                                type="button"
                                variant={selectedOffer?.offer === offer && selectedOffer.side === 'under' ? 'default' : 'outline'}
                                className="justify-between"
                                onClick={() => applyLiveOfferSelection(offer, 'under')}
                              >
                                <span>Under</span>
                                <span>{buildOddsLabel(offer.underOdds)}</span>
                              </Button>
                            </div>
                          </div>
                        );
                      })}
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
                    ) : selectedMarketType === 'moneyline' || selectedMarketType === 'spread' || selectedMarketType === 'total' || selectedMarketType === 'player-prop' ? null : (
                      <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
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

                    {selectedMarketType === 'player-prop' && filteredOffers.length === 0 ? (
                      <div className="space-y-4 rounded-xl border border-border bg-background px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Player Prop Ticket
                          </p>
                          <span className="text-xs text-muted-foreground">Manual fallback</span>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-xl border border-border bg-background/70 px-4 py-4">
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Player</p>
                            <p className="mt-1 font-semibold text-foreground">
                              {watchedValues.playerName || 'Choose player above'}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {watchedValues.team || 'Team will lock from selection'}
                            </p>
                          </div>
                          <div className="rounded-xl border border-border bg-background/70 px-4 py-4">
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stat Type</p>
                            <p className="mt-1 font-semibold text-foreground">
                              {watchedValues.statType || 'Choose stat above'}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Matchup stays locked to the selected game
                            </p>
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Button
                            type="button"
                            variant={watchedValues.direction === 'over' ? 'default' : 'outline'}
                            className="justify-between"
                            onClick={() => form.setValue('direction', 'over', {
                              shouldDirty: true,
                              shouldTouch: true,
                              shouldValidate: true,
                            })}
                          >
                            <span>Over</span>
                            <span>Select</span>
                          </Button>
                          <Button
                            type="button"
                            variant={watchedValues.direction === 'under' ? 'default' : 'outline'}
                            className="justify-between"
                            onClick={() => form.setValue('direction', 'under', {
                              shouldDirty: true,
                              shouldTouch: true,
                              shouldValidate: true,
                            })}
                          >
                            <span>Under</span>
                            <span>Select</span>
                          </Button>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
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
                    ) : null}
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
            name="team"
            label="Team"
            placeholder="Type a team name"
            searchType="team"
            eventId={selectedMatchupId}
            sport={selectedSport}
            allowedParticipantIds={allowedTeamIds}
            onSuggestionSelected={handleTeamSuggestionSelection}
            onManualChange={() => setSelectedTeamId(null)}
          />
          <ParticipantAutocompleteField
            form={form}
            name="playerName"
            label="Player Name"
            placeholder="Type a player name"
            searchType="player"
            eventId={selectedMatchupId}
            sport={selectedSport}
            allowedParticipantIds={allowedPlayerIds}
            onSuggestionSelected={handlePlayerSuggestionSelection}
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
                    <Input
                      placeholder="e.g. Knicks vs Heat"
                      readOnly={browseMode === 'live-offer' && Boolean(selectedMatchup)}
                      {...field}
                    />
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
                  <Select
                    disabled={availablePlayerPropStatTypes.length === 0}
                    onValueChange={field.onChange}
                    value={field.value ?? ''}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select stat" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availablePlayerPropStatTypes.map((statType) => (
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
          {selectedMatchup ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-dashed border-border bg-background/60 px-4 py-3 text-sm text-muted-foreground">
                Matchup locked from Browse Setup: {formatMatchup(selectedMatchup)}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {matchupTeams.map((team) => {
                  const isSelected = selectedTeamId === (team.teamId ?? team.participantId);
                  const offer = moneylineOfferMap.get(team.teamId ?? '') ?? moneylineOfferMap.get(team.participantId);
                  return (
                    <button
                      key={team.participantId}
                      type="button"
                      onClick={() => applyMoneylineTeamSelection(team)}
                      className={cn(
                        'rounded-xl border px-4 py-4 text-left transition-colors',
                        isSelected
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-background hover:border-primary/50',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground">{team.displayName}</p>
                          <p className="text-xs text-muted-foreground">
                            {offer?.sportsbookName ?? (selectedSportsbookValue ? watchedValues.sportsbook : 'Manual odds')}
                          </p>
                        </div>
                        <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-foreground">
                          {buildOddsLabel(offer?.overOdds)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
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
                eventId={selectedMatchupId}
                sport={selectedSport}
                allowedParticipantIds={allowedTeamIds}
                onSuggestionSelected={handleTeamSuggestionSelection}
                onManualChange={() => setSelectedTeamId(null)}
              />
            </>
          )}
        </div>
      );
    }

    if (selectedMarketType === 'spread') {
      return (
        <div className="space-y-4">
          {selectedMatchup ? (
            <>
              <div className="space-y-3">
                <div className="rounded-xl border border-dashed border-border bg-background/60 px-4 py-3 text-sm text-muted-foreground">
                  Matchup locked from Browse Setup: {formatMatchup(selectedMatchup)}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {matchupTeams.map((team) => {
                    const teamKey = team.teamId ?? team.participantId;
                    const isSelected = selectedTeamId === teamKey;
                    const selectedLineLabel =
                      isSelected && typeof watchedValues.line === 'number'
                        ? formatLineLabel(watchedValues.line) ?? `${watchedValues.line}`
                        : null;
                    return (
                      <button
                        key={team.participantId}
                        type="button"
                        onClick={() => {
                          form.setValue('team', team.displayName, {
                            shouldDirty: true,
                            shouldTouch: true,
                            shouldValidate: true,
                          });
                          setSelectedTeamId(teamKey);
                        }}
                        className={cn(
                          'rounded-xl border px-4 py-4 text-left transition-colors',
                          isSelected
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-background hover:border-primary/50',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-foreground">{team.displayName}</p>
                            <p className="text-xs text-muted-foreground">
                              {selectedSportsbookValue ? watchedValues.sportsbook : 'Manual spread entry'}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'rounded-full border px-2.5 py-1 text-xs font-semibold',
                              isSelected
                                ? 'border-primary/40 bg-primary/10 text-primary'
                                : 'border-border text-muted-foreground',
                            )}
                          >
                            {selectedLineLabel ?? 'Enter line'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-background/60 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {selectedTeamId
                        ? `${matchupTeams.find((team) => (team.teamId ?? team.participantId) === selectedTeamId)?.displayName ?? 'Selected team'} spread`
                        : 'Spread ticket'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Pick a side above, then enter the spread line to finish the ticket.
                    </p>
                  </div>
                  <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                    {selectedSportsbookValue ? watchedValues.sportsbook : 'Manual'}
                  </span>
                </div>
                <div className="mt-4">
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
            </>
          ) : (
            <>
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
                  eventId={selectedMatchupId}
                  sport={selectedSport}
                  allowedParticipantIds={allowedTeamIds}
                  onSuggestionSelected={handleTeamSuggestionSelection}
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
            </>
          )}
        </div>
      );
    }

    if (selectedMarketType === 'total') {
      return (
        <div className="space-y-4">
          {selectedMatchup ? (
            <>
              <div className="space-y-3">
                <div className="rounded-xl border border-dashed border-border bg-background/60 px-4 py-3 text-sm text-muted-foreground">
                  Matchup locked from Browse Setup: {formatMatchup(selectedMatchup)}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(['over', 'under'] as const).map((direction) => {
                    const isSelected = watchedValues.direction === direction;
                    const selectedLineLabel =
                      isSelected && typeof watchedValues.line === 'number'
                        ? formatLineLabel(watchedValues.line) ?? `${watchedValues.line}`
                        : null;
                    return (
                      <button
                        key={direction}
                        type="button"
                        onClick={() => {
                          form.setValue('direction', direction, {
                            shouldDirty: true,
                            shouldTouch: true,
                            shouldValidate: true,
                          });
                        }}
                        className={cn(
                          'rounded-xl border px-4 py-4 text-left transition-colors',
                          isSelected
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-background hover:border-primary/50',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-foreground">
                              {direction === 'over' ? 'Over' : 'Under'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {selectedSportsbookValue ? watchedValues.sportsbook : 'Manual total entry'}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'rounded-full border px-2.5 py-1 text-xs font-semibold',
                              isSelected
                                ? 'border-primary/40 bg-primary/10 text-primary'
                                : 'border-border text-muted-foreground',
                            )}
                          >
                            {selectedLineLabel ?? 'Enter total'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-background/60 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {watchedValues.direction
                        ? `${watchedValues.direction === 'over' ? 'Over' : 'Under'} total`
                        : 'Game total ticket'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Pick a side above, then enter the total line to finish the ticket.
                    </p>
                  </div>
                  <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                    {selectedSportsbookValue ? watchedValues.sportsbook : 'Manual'}
                  </span>
                </div>
                <div className="mt-4">
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
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      );
    }

    if (selectedMarketType === 'team-total') {
      return (
        <div className="space-y-4">
          {selectedMatchup ? (
            <>
              <div className="space-y-3">
                <div className="rounded-xl border border-dashed border-border bg-background/60 px-4 py-3 text-sm text-muted-foreground">
                  Matchup locked from Browse Setup: {formatMatchup(selectedMatchup)}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {matchupTeams.map((team) => {
                    const teamKey = team.teamId ?? team.participantId;
                    const isSelected = selectedTeamId === teamKey;
                    return (
                      <button
                        key={team.participantId}
                        type="button"
                        onClick={() => {
                          form.setValue('team', team.displayName, {
                            shouldDirty: true,
                            shouldTouch: true,
                            shouldValidate: true,
                          });
                          setSelectedTeamId(teamKey);
                        }}
                        className={cn(
                          'rounded-xl border px-4 py-4 text-left transition-colors',
                          isSelected
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-background hover:border-primary/50',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-foreground">{team.displayName}</p>
                            <p className="text-xs text-muted-foreground">
                              {selectedSportsbookValue ? watchedValues.sportsbook : 'Manual team total entry'}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'rounded-full border px-2.5 py-1 text-xs font-semibold',
                              isSelected
                                ? 'border-primary/40 bg-primary/10 text-primary'
                                : 'border-border text-muted-foreground',
                            )}
                          >
                            {isSelected ? 'Selected' : 'Pick team'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['over', 'under'] as const).map((direction) => {
                  const isSelected = watchedValues.direction === direction;
                  const selectedLineLabel =
                    isSelected && typeof watchedValues.line === 'number'
                      ? formatLineLabel(watchedValues.line) ?? `${watchedValues.line}`
                      : null;
                  return (
                    <button
                      key={direction}
                      type="button"
                      onClick={() => {
                        form.setValue('direction', direction, {
                          shouldDirty: true,
                          shouldTouch: true,
                          shouldValidate: true,
                        });
                      }}
                      className={cn(
                        'rounded-xl border px-4 py-4 text-left transition-colors',
                        isSelected
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-background hover:border-primary/50',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground">
                            {direction === 'over' ? 'Over' : 'Under'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {selectedSportsbookValue ? watchedValues.sportsbook : 'Manual team total entry'}
                          </p>
                        </div>
                        <span
                          className={cn(
                            'rounded-full border px-2.5 py-1 text-xs font-semibold',
                            isSelected
                              ? 'border-primary/40 bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground',
                          )}
                        >
                          {selectedLineLabel ?? 'Enter total'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="rounded-xl border border-border bg-background/60 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {selectedTeamId
                        ? `${matchupTeams.find((team) => (team.teamId ?? team.participantId) === selectedTeamId)?.displayName ?? 'Selected team'} total`
                        : 'Team total ticket'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Choose the team and side above, then enter the team total line to finish the ticket.
                    </p>
                  </div>
                  <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                    {selectedSportsbookValue ? watchedValues.sportsbook : 'Manual'}
                  </span>
                </div>
                <div className="mt-4">
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
              </div>
            </>
          ) : (
            <>
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
                  eventId={selectedMatchupId}
                  sport={selectedSport}
                  allowedParticipantIds={allowedTeamIds}
                  onSuggestionSelected={handleTeamSuggestionSelection}
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
            </>
          )}
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

                <div className="grid gap-4 md:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="sport"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sport</FormLabel>
                        <FormControl>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {catalog.sports.map((sport: SportDefinition) => {
                              const isSelected = field.value === sport.id;
                              return (
                                <button
                                  key={sport.id}
                                  type="button"
                                  className={cn(
                                    'rounded-xl border px-3 py-3 text-left text-sm font-medium transition-colors',
                                    isSelected
                                      ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                                      : 'border-border bg-background text-foreground hover:border-foreground/30 hover:bg-muted',
                                  )}
                                  onClick={() => field.onChange(sport.id)}
                                >
                                  {sport.name}
                                </button>
                              );
                            })}
                          </div>
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          Pick a sport first so matchups, participants, and market families stay filtered correctly.
                        </p>
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

                  <SearchableSportsbookField form={form} sportsbooks={catalog.sportsbooks} />
                </div>
              </section>

              {renderLiveOfferSection()}

              {shouldRenderPickDetailsSection ? (
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

                {!hasSelectedBrowseMatchup ? (
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
                ) : null}

                {selectedMatchup && shouldShowManualFallback ? (
                  <div className="rounded-xl border border-dashed border-border bg-background/60 px-4 py-3 text-sm text-muted-foreground">
                    The selected matchup is preserved from canonical browse data. You can finish this pick manually if the exact live offer is not present.
                  </div>
                ) : null}

                {!selectedMatchup && browseMode === 'manual' ? (
                  <div className="rounded-xl border border-dashed border-border bg-background/60 px-4 py-3 text-sm text-muted-foreground">
                    Manual fallback is active. Matchup is still required, and current fallback uses free-text event entry until structured matchup selection is available.
                  </div>
                ) : null}

                {renderBetDetailsSection()}
                </section>
              ) : null}

              <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-foreground">Book, Odds, and Submission</h2>
                <div className="grid gap-4 md:grid-cols-2">
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
                            onChange={(event) => field.onChange(normalizeUnitsValue(event.target.value))}
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
                            onChange={(event) => field.onChange(normalizeConvictionValue(event.target.value))}
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          How confident are you in this pick? (1 = low, 10 = highest conviction)
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <SearchableCapperField form={form} cappers={catalog.cappers} />
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
