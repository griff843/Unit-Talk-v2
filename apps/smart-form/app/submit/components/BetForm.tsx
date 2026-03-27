'use client';

import { useEffect, useState } from 'react';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { CatalogData } from '@/lib/catalog';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { betFormSchema, type BetFormValues, type MarketTypeId } from '@/lib/form-schema';
import { getMarketTypesForSport, getStatTypesForSport, buildSubmissionPayload } from '@/lib/form-utils';
import { submitPick, getCatalog, type SubmitPickResult } from '@/lib/api-client';
import { MarketTypeGrid } from './MarketTypeGrid';
import { BetSlipPanel } from './BetSlipPanel';
import { SuccessReceipt } from './SuccessReceipt';

const OPERATOR_WEB_URL = process.env.NEXT_PUBLIC_OPERATOR_WEB_URL ?? 'http://127.0.0.1:4200';
const TODAY = new Date().toISOString().slice(0, 10);
const PARTICIPANT_QUERY_MIN = 2;
const PARTICIPANT_LIMIT = 10;

type ParticipantSearchType = 'player' | 'team';
type ParticipantFieldName = 'playerName' | 'team';

interface ParticipantSuggestion {
  displayName: string;
  participantType: ParticipantSearchType;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function buildParticipantSearchUrl(
  query: string,
  participantType: ParticipantSearchType,
  sport?: string,
): string {
  const params = new URLSearchParams({
    q: query.trim(),
    type: participantType,
    limit: String(PARTICIPANT_LIMIT),
  });

  if (sport?.trim()) {
    params.set('sport', sport.trim());
  }

  return `${OPERATOR_WEB_URL}/api/operator/participants?${params.toString()}`;
}

export function normalizeParticipantSearchResults(
  payload: unknown,
  expectedType: ParticipantSearchType,
): ParticipantSuggestion[] {
  const participants = isRecord(payload) && Array.isArray(payload.participants)
    ? payload.participants
    : [];
  const seen = new Set<string>();

  return participants
    .flatMap((row) => {
      if (!isRecord(row)) {
        return [];
      }

      if (typeof row.displayName !== 'string' || row.participantType !== expectedType) {
        return [];
      }

      const displayName = row.displayName.trim();
      if (!displayName) {
        return [];
      }

      const dedupeKey = displayName.toLowerCase();
      if (seen.has(dedupeKey)) {
        return [];
      }

      seen.add(dedupeKey);
      return [{ displayName, participantType: expectedType }];
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

interface ParticipantAutocompleteFieldProps {
  form: UseFormReturn<BetFormValues>;
  name: ParticipantFieldName;
  label: string;
  placeholder: string;
  searchType: ParticipantSearchType;
  sport: string;
}

function ParticipantAutocompleteField({
  form,
  name,
  label,
  placeholder,
  searchType,
  sport,
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

        setSuggestions(normalizeParticipantSearchResults(json, searchType));
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
  }, [form.control, name, searchType, sport, value]);

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
                      key={`${suggestion.participantType}:${suggestion.displayName}`}
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

export function BetForm() {
  const { toast } = useToast();
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successResult, setSuccessResult] = useState<SubmitPickResult | null>(null);
  const [submittedValues, setSubmittedValues] = useState<BetFormValues | null>(null);

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

  // When sport changes, clear market type and bet detail fields.
  // eventName (matchup) is preserved — it's often sport-agnostic.
  useEffect(() => {
    form.setValue('marketType', undefined as unknown as MarketTypeId);
    form.setValue('playerName', '');
    form.setValue('statType', '');
    form.setValue('team', '');
    form.setValue('direction', undefined);
    form.setValue('line', undefined);
  }, [selectedSport, form]);

  // When market type changes, clear only the fields that belong to the previous market type.
  // eventName, odds, units, sportsbook, and capper are preserved.
  useEffect(() => {
    form.setValue('playerName', '');
    form.setValue('statType', '');
    form.setValue('team', '');
    form.setValue('direction', undefined);
    form.setValue('line', undefined);
  }, [selectedMarketType, form]);

  useEffect(() => {
    getCatalog()
      .then(setCatalog)
      .catch((err: unknown) => setCatalogError(err instanceof Error ? err.message : 'Reference data unavailable'));
  }, []);

  async function onSubmit(values: BetFormValues) {
    setIsSubmitting(true);
    try {
      const payload = buildSubmissionPayload(values);
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

  const availableMarketTypes = selectedSport
    ? getMarketTypesForSport(catalog, selectedSport)
    : [];

  const availableStatTypes = selectedSport
    ? getStatTypesForSport(catalog, selectedSport)
    : [];

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
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <div className="min-h-screen bg-background">
          <div className="max-w-5xl mx-auto px-4 py-8">
            {/* Page header */}
            <div className="mb-8">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-1">
                Unit Talk
              </p>
              <h1 className="text-3xl font-condensed font-semibold tracking-tight text-foreground">
                Submit Pick
              </h1>
            </div>

            <div className="grid lg:grid-cols-[1fr,380px] gap-8 items-start">
              {/* LEFT: Form */}
              <div className="space-y-8 pb-24 lg:pb-0">
                <>
                    {/* Section: Sport */}
                    <section className="space-y-4">
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Sport
                      </h2>
                      <FormField
                        control={form.control}
                        name="sport"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Sport</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger className="w-full sm:max-w-[240px]">
                                  <SelectValue placeholder="Select sport" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {catalog.sports.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {s.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </section>

                    {selectedSport && (
                      <>
                        <Separator className="bg-border/50" />

                        {/* Section: Market Type */}
                        <section className="space-y-4">
                          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Market Type
                          </h2>
                          <FormField
                            control={form.control}
                            name="marketType"
                            render={({ field }) => (
                              <FormItem>
                                <MarketTypeGrid
                                  availableTypes={availableMarketTypes}
                                  selected={field.value}
                                  onSelect={(type) => field.onChange(type)}
                                />
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </section>

                        {selectedMarketType && (
                          <>
                            <Separator className="bg-border/50" />

                            {/* Section: Bet Details */}
                            <section className="space-y-4">
                              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Bet Details
                              </h2>
                              {renderBetDetailsSection()}
                            </section>

                            <Separator className="bg-border/50" />

                            {/* Section: Book & Odds */}
                            <section className="space-y-4">
                              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Book &amp; Odds
                              </h2>
                              <div className="grid grid-cols-2 gap-4">
                                <FormField
                                  control={form.control}
                                  name="sportsbook"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Sportsbook</FormLabel>
                                      <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                          <SelectTrigger>
                                            <SelectValue placeholder="Select book" />
                                          </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                          {catalog.sportsbooks.map((b) => (
                                            <SelectItem key={b.id} value={b.name}>
                                              {b.name}
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
                                          placeholder="-110"
                                          {...field}
                                          value={field.value ?? ''}
                                          onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>
                            </section>

                            <Separator className="bg-border/50" />

                            {/* Section: Stake */}
                            <section className="space-y-4">
                              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Stake
                              </h2>
                              <div className="grid grid-cols-2 gap-4">
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
                                          placeholder="2.0"
                                          {...field}
                                          value={field.value ?? ''}
                                          onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
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
                                          min="1"
                                          max="10"
                                          step="1"
                                          placeholder="8"
                                          {...field}
                                          value={field.value ?? ''}
                                          onChange={(e) =>
                                            field.onChange(
                                              e.target.value === '' ? undefined : Number(e.target.value),
                                            )
                                          }
                                        />
                                      </FormControl>
                                      <p className="text-xs text-muted-foreground">
                                        How confident are you in this pick? (1 = low, 10 = highest conviction)
                                      </p>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <FormField
                                  control={form.control}
                                  name="capper"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Capper</FormLabel>
                                      <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                          <SelectTrigger>
                                            <SelectValue placeholder="Select capper" />
                                          </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                          {catalog.cappers.map((c) => (
                                            <SelectItem key={c} value={c}>
                                              {c}
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
                                      <FormLabel>Game Date</FormLabel>
                                      <FormControl>
                                        <Input
                                          type="date"
                                          className="w-full sm:max-w-[200px]"
                                          {...field}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>
                            </section>
                          </>
                        )}
                      </>
                    )}
                </>
              </div>

              {/* RIGHT: Bet Slip Panel */}
              <BetSlipPanel
                values={watchedValues}
                isSubmitting={isSubmitting}
                onSubmit={form.handleSubmit(onSubmit)}
              />
            </div>
          </div>
        </div>
      </form>
    </Form>
  );
}
