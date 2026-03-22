/**
 * Smart Form V1 — Reference Data Client
 *
 * Single import point for reference data in the smart form.
 * V1: returns static catalog from @unit-talk/contracts.
 * Future: fetch from API endpoint — only this file changes.
 */

export {
  V1_REFERENCE_DATA,
  getSportById,
  getStatTypesForSport,
  getTeamsForSport,
  getMarketTypesForSport,
  getEnabledTicketTypes,
  isValidCapper,
  isValidSportsbook,
  isValidSportId,
  isValidTeamForSport,
  isValidStatTypeForSport,
  type ReferenceDataCatalog,
  type SportDefinition,
  type SportsbookDefinition,
  type TicketTypeDefinition,
  type MarketTypeId,
} from '@unit-talk/contracts';

import { V1_REFERENCE_DATA, type ReferenceDataCatalog } from '@unit-talk/contracts';

export function getFormReferenceData(): ReferenceDataCatalog {
  return V1_REFERENCE_DATA;
}
