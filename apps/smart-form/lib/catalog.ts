/**
 * Type definitions for the reference-data catalog.
 * Live data is fetched from GET /api/reference-data/catalog — do not add static data here.
 */

export type MarketTypeId =
  | 'player-prop'
  | 'moneyline'
  | 'spread'
  | 'total'
  | 'team-total';

export interface SportDefinition {
  id: string;
  name: string;
  marketTypes: MarketTypeId[];
  statTypes: string[];
  teams: string[];
}

export interface SportsbookDefinition {
  id: string;
  name: string;
}

export interface TicketTypeDefinition {
  id: string;
  name: string;
  enabled: boolean;
}

export interface CatalogData {
  sports: SportDefinition[];
  sportsbooks: SportsbookDefinition[];
  ticketTypes: TicketTypeDefinition[];
  cappers: string[];
}
