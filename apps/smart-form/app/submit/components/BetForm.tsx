'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
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
import { BetDetailsSection } from './BetDetailsSection';
import { BetSlipPanel } from './BetSlipPanel';
import { SuccessReceipt } from './SuccessReceipt';

const TODAY = new Date().toISOString().slice(0, 10);

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

  const availableTeams = selectedSport
    ? (catalog.sports.find((s) => s.id === selectedSport)?.teams ?? [])
    : [];

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
                              <BetDetailsSection
                                marketType={selectedMarketType}
                                statTypes={availableStatTypes}
                                teams={availableTeams}
                              />
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
