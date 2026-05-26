export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alert_detections: {
        Row: {
          baseline_snapshot_at: string
          bookmaker_key: string
          cooldown_expires_at: string | null
          created_at: string
          current_snapshot_at: string
          direction: string
          event_id: string
          first_mover_book: string | null
          id: string
          idempotency_key: string
          line_change: number
          line_change_abs: number
          market_key: string
          market_type: string
          metadata: Json
          new_line: number
          notified: boolean
          notified_at: string | null
          notified_channels: string[] | null
          old_line: number
          participant_id: string | null
          steam_detected: boolean
          tier: string
          time_elapsed_minutes: number
          velocity: number | null
        }
        Insert: {
          baseline_snapshot_at: string
          bookmaker_key: string
          cooldown_expires_at?: string | null
          created_at?: string
          current_snapshot_at: string
          direction: string
          event_id: string
          first_mover_book?: string | null
          id?: string
          idempotency_key: string
          line_change: number
          line_change_abs: number
          market_key: string
          market_type: string
          metadata?: Json
          new_line: number
          notified?: boolean
          notified_at?: string | null
          notified_channels?: string[] | null
          old_line: number
          participant_id?: string | null
          steam_detected?: boolean
          tier: string
          time_elapsed_minutes: number
          velocity?: number | null
        }
        Update: {
          baseline_snapshot_at?: string
          bookmaker_key?: string
          cooldown_expires_at?: string | null
          created_at?: string
          current_snapshot_at?: string
          direction?: string
          event_id?: string
          first_mover_book?: string | null
          id?: string
          idempotency_key?: string
          line_change?: number
          line_change_abs?: number
          market_key?: string
          market_type?: string
          metadata?: Json
          new_line?: number
          notified?: boolean
          notified_at?: string | null
          notified_channels?: string[] | null
          old_line?: number
          participant_id?: string | null
          steam_detected?: boolean
          tier?: string
          time_elapsed_minutes?: number
          velocity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_detections_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          entity_id: string | null
          entity_ref: string | null
          entity_type: string
          id: string
          payload: Json
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          entity_id?: string | null
          entity_ref?: string | null
          entity_type: string
          id?: string
          payload?: Json
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          entity_id?: string | null
          entity_ref?: string | null
          entity_type?: string
          id?: string
          payload?: Json
        }
        Relationships: []
      }
      cappers: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          id: string
          metadata: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          id: string
          metadata?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          id?: string
          metadata?: Json
          updated_at?: string
        }
        Relationships: []
      }
      certification_records: {
        Row: {
          created_at: string
          domain: Database["public"]["Enums"]["certification_domain"]
          evidence_sha: string
          expires_at: string | null
          id: string
          merge_sha: string
          predecessor_id: string | null
          program_id: string
          revocation_trigger:
            | Database["public"]["Enums"]["revocation_trigger"]
            | null
          status: Database["public"]["Enums"]["certification_status"]
          transition_reason: string
          transitioned_at: string
          transitioned_by: string
        }
        Insert: {
          created_at?: string
          domain: Database["public"]["Enums"]["certification_domain"]
          evidence_sha: string
          expires_at?: string | null
          id?: string
          merge_sha: string
          predecessor_id?: string | null
          program_id: string
          revocation_trigger?:
            | Database["public"]["Enums"]["revocation_trigger"]
            | null
          status: Database["public"]["Enums"]["certification_status"]
          transition_reason: string
          transitioned_at?: string
          transitioned_by: string
        }
        Update: {
          created_at?: string
          domain?: Database["public"]["Enums"]["certification_domain"]
          evidence_sha?: string
          expires_at?: string | null
          id?: string
          merge_sha?: string
          predecessor_id?: string | null
          program_id?: string
          revocation_trigger?:
            | Database["public"]["Enums"]["revocation_trigger"]
            | null
          status?: Database["public"]["Enums"]["certification_status"]
          transition_reason?: string
          transitioned_at?: string
          transitioned_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "certification_records_predecessor_id_fkey"
            columns: ["predecessor_id"]
            isOneToOne: false
            referencedRelation: "certification_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certification_records_predecessor_id_fkey"
            columns: ["predecessor_id"]
            isOneToOne: false
            referencedRelation: "current_certification_state"
            referencedColumns: ["id"]
          },
        ]
      }
      certification_transition_events: {
        Row: {
          cert_record_id: string
          domain: Database["public"]["Enums"]["certification_domain"]
          evidence_sha: string | null
          from_status:
            | Database["public"]["Enums"]["certification_status"]
            | null
          id: string
          occurred_at: string
          program_id: string
          replay_safe: boolean
          to_status: Database["public"]["Enums"]["certification_status"]
          trigger_reason: string
          triggered_by: string
        }
        Insert: {
          cert_record_id: string
          domain: Database["public"]["Enums"]["certification_domain"]
          evidence_sha?: string | null
          from_status?:
            | Database["public"]["Enums"]["certification_status"]
            | null
          id?: string
          occurred_at?: string
          program_id: string
          replay_safe?: boolean
          to_status: Database["public"]["Enums"]["certification_status"]
          trigger_reason: string
          triggered_by: string
        }
        Update: {
          cert_record_id?: string
          domain?: Database["public"]["Enums"]["certification_domain"]
          evidence_sha?: string | null
          from_status?:
            | Database["public"]["Enums"]["certification_status"]
            | null
          id?: string
          occurred_at?: string
          program_id?: string
          replay_safe?: boolean
          to_status?: Database["public"]["Enums"]["certification_status"]
          trigger_reason?: string
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "certification_transition_events_cert_record_id_fkey"
            columns: ["cert_record_id"]
            isOneToOne: false
            referencedRelation: "certification_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certification_transition_events_cert_record_id_fkey"
            columns: ["cert_record_id"]
            isOneToOne: false
            referencedRelation: "current_certification_state"
            referencedColumns: ["id"]
          },
        ]
      }
      combo_stat_type_components: {
        Row: {
          combo_stat_type_id: string
          created_at: string
          stat_type_id: string
          weight: number
        }
        Insert: {
          combo_stat_type_id: string
          created_at?: string
          stat_type_id: string
          weight?: number
        }
        Update: {
          combo_stat_type_id?: string
          created_at?: string
          stat_type_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "combo_stat_type_components_combo_stat_type_id_fkey"
            columns: ["combo_stat_type_id"]
            isOneToOne: false
            referencedRelation: "combo_stat_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_stat_type_components_stat_type_id_fkey"
            columns: ["stat_type_id"]
            isOneToOne: false
            referencedRelation: "stat_types"
            referencedColumns: ["id"]
          },
        ]
      }
      combo_stat_types: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          id: string
          market_type_id: string
          metadata: Json
          short_label: string
          sort_order: number
          sport_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          id: string
          market_type_id: string
          metadata?: Json
          short_label: string
          sort_order?: number
          sport_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          id?: string
          market_type_id?: string
          metadata?: Json
          short_label?: string
          sort_order?: number
          sport_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "combo_stat_types_market_type_id_fkey"
            columns: ["market_type_id"]
            isOneToOne: false
            referencedRelation: "market_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_stat_types_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      distribution_outbox: {
        Row: {
          attempt_count: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          last_error: string | null
          next_attempt_at: string | null
          payload: Json
          pick_id: string
          status: string
          target: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          next_attempt_at?: string | null
          payload?: Json
          pick_id: string
          status?: string
          target: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          next_attempt_at?: string | null
          payload?: Json
          pick_id?: string
          status?: string
          target?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "distribution_outbox_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "picks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_outbox_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "picks_current_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_outbox_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "v_governed_pick_performance"
            referencedColumns: ["pick_id"]
          },
        ]
      }
      distribution_receipts: {
        Row: {
          channel: string | null
          external_id: string | null
          id: string
          idempotency_key: string | null
          outbox_id: string
          payload: Json
          receipt_type: string
          recorded_at: string
          status: string
        }
        Insert: {
          channel?: string | null
          external_id?: string | null
          id?: string
          idempotency_key?: string | null
          outbox_id: string
          payload?: Json
          receipt_type: string
          recorded_at?: string
          status: string
        }
        Update: {
          channel?: string | null
          external_id?: string | null
          id?: string
          idempotency_key?: string | null
          outbox_id?: string
          payload?: Json
          receipt_type?: string
          recorded_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "distribution_receipts_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "distribution_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      event_participants: {
        Row: {
          created_at: string
          event_id: string
          id: string
          participant_id: string
          role: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          participant_id: string
          role: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          participant_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_participants_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_participants_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          event_date: string
          event_name: string
          external_id: string | null
          id: string
          metadata: Json
          sport_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_date: string
          event_name: string
          external_id?: string | null
          id?: string
          metadata?: Json
          sport_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_date?: string
          event_name?: string
          external_id?: string | null
          id?: string
          metadata?: Json
          sport_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      experiment_ledger: {
        Row: {
          created_at: string
          finished_at: string | null
          id: string
          market_family: string
          metrics: Json
          model_id: string
          notes: string | null
          run_type: string
          sport: string
          started_at: string
          status: string
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          id?: string
          market_family: string
          metrics?: Json
          model_id: string
          notes?: string | null
          run_type: string
          sport: string
          started_at?: string
          status?: string
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          id?: string
          market_family?: string
          metrics?: Json
          model_id?: string
          notes?: string | null
          run_type?: string
          sport?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiment_ledger_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "model_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      game_results: {
        Row: {
          actual_value: number
          created_at: string
          event_id: string
          id: string
          market_key: string
          participant_id: string | null
          source: string
          sourced_at: string
        }
        Insert: {
          actual_value: number
          created_at?: string
          event_id: string
          id?: string
          market_key: string
          participant_id?: string | null
          source?: string
          sourced_at: string
        }
        Update: {
          actual_value?: number
          created_at?: string
          event_id?: string
          id?: string
          market_key?: string
          participant_id?: string | null
          source?: string
          sourced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_results_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_results_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      hedge_opportunities: {
        Row: {
          arbitrage_percentage: number
          bookmaker_a: string
          bookmaker_b: string
          cooldown_expires_at: string | null
          created_at: string
          detected_at: string
          event_id: string | null
          guaranteed_profit: number | null
          id: string
          idempotency_key: string
          implied_prob_a: number
          implied_prob_b: number
          line_a: number
          line_b: number
          line_discrepancy: number
          market_key: string
          metadata: Json
          middle_gap: number | null
          notified: boolean
          notified_at: string | null
          notified_channels: string[] | null
          over_odds_a: number | null
          participant_id: string | null
          priority: string
          profit_potential: number
          total_implied_prob: number
          type: string
          under_odds_b: number | null
          win_probability: number | null
        }
        Insert: {
          arbitrage_percentage: number
          bookmaker_a: string
          bookmaker_b: string
          cooldown_expires_at?: string | null
          created_at?: string
          detected_at?: string
          event_id?: string | null
          guaranteed_profit?: number | null
          id?: string
          idempotency_key: string
          implied_prob_a: number
          implied_prob_b: number
          line_a: number
          line_b: number
          line_discrepancy: number
          market_key: string
          metadata?: Json
          middle_gap?: number | null
          notified?: boolean
          notified_at?: string | null
          notified_channels?: string[] | null
          over_odds_a?: number | null
          participant_id?: string | null
          priority: string
          profit_potential: number
          total_implied_prob: number
          type: string
          under_odds_b?: number | null
          win_probability?: number | null
        }
        Update: {
          arbitrage_percentage?: number
          bookmaker_a?: string
          bookmaker_b?: string
          cooldown_expires_at?: string | null
          created_at?: string
          detected_at?: string
          event_id?: string | null
          guaranteed_profit?: number | null
          id?: string
          idempotency_key?: string
          implied_prob_a?: number
          implied_prob_b?: number
          line_a?: number
          line_b?: number
          line_discrepancy?: number
          market_key?: string
          metadata?: Json
          middle_gap?: number | null
          notified?: boolean
          notified_at?: string | null
          notified_channels?: string[] | null
          over_odds_a?: number | null
          participant_id?: string | null
          priority?: string
          profit_potential?: number
          total_implied_prob?: number
          type?: string
          under_odds_b?: number | null
          win_probability?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "hedge_opportunities_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hedge_opportunities_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          active: boolean
          country: string | null
          created_at: string
          display_name: string
          id: string
          metadata: Json
          sort_order: number
          sport_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          country?: string | null
          created_at?: string
          display_name: string
          id: string
          metadata?: Json
          sort_order?: number
          sport_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          country?: string | null
          created_at?: string
          display_name?: string
          id?: string
          metadata?: Json
          sort_order?: number
          sport_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leagues_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      market_families: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          id: string
          metadata: Json
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          id: string
          metadata?: Json
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          id?: string
          metadata?: Json
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      market_family_trust: {
        Row: {
          avg_model_score: number | null
          computed_at: string
          confidence_band: string | null
          id: string
          loss_count: number
          market_type_id: string
          metadata: Json
          push_count: number
          roi: number | null
          sample_size: number
          sport_key: string | null
          tuning_run_id: string
          win_count: number
          win_rate: number | null
        }
        Insert: {
          avg_model_score?: number | null
          computed_at?: string
          confidence_band?: string | null
          id?: string
          loss_count: number
          market_type_id: string
          metadata?: Json
          push_count: number
          roi?: number | null
          sample_size: number
          sport_key?: string | null
          tuning_run_id: string
          win_count: number
          win_rate?: number | null
        }
        Update: {
          avg_model_score?: number | null
          computed_at?: string
          confidence_band?: string | null
          id?: string
          loss_count?: number
          market_type_id?: string
          metadata?: Json
          push_count?: number
          roi?: number | null
          sample_size?: number
          sport_key?: string | null
          tuning_run_id?: string
          win_count?: number
          win_rate?: number | null
        }
        Relationships: []
      }
      market_types: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          id: string
          market_family_id: string
          metadata: Json
          requires_line: boolean
          requires_participant: boolean
          selection_type_id: string
          short_label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          id: string
          market_family_id: string
          metadata?: Json
          requires_line?: boolean
          requires_participant?: boolean
          selection_type_id: string
          short_label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          id?: string
          market_family_id?: string
          metadata?: Json
          requires_line?: boolean
          requires_participant?: boolean
          selection_type_id?: string
          short_label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_types_market_family_id_fkey"
            columns: ["market_family_id"]
            isOneToOne: false
            referencedRelation: "market_families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_types_selection_type_id_fkey"
            columns: ["selection_type_id"]
            isOneToOne: false
            referencedRelation: "selection_types"
            referencedColumns: ["id"]
          },
        ]
      }
      market_universe: {
        Row: {
          canonical_market_key: string
          closing_line: number | null
          closing_over_odds: number | null
          closing_under_odds: number | null
          created_at: string
          current_line: number | null
          current_over_odds: number | null
          current_under_odds: number | null
          event_id: string | null
          fair_over_prob: number | null
          fair_under_prob: number | null
          id: string
          is_stale: boolean
          last_offer_snapshot_at: string
          league_key: string
          market_type_id: string | null
          opening_line: number | null
          opening_over_odds: number | null
          opening_under_odds: number | null
          participant_id: string | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          refreshed_at: string
          sport_key: string
          updated_at: string
        }
        Insert: {
          canonical_market_key: string
          closing_line?: number | null
          closing_over_odds?: number | null
          closing_under_odds?: number | null
          created_at?: string
          current_line?: number | null
          current_over_odds?: number | null
          current_under_odds?: number | null
          event_id?: string | null
          fair_over_prob?: number | null
          fair_under_prob?: number | null
          id?: string
          is_stale?: boolean
          last_offer_snapshot_at: string
          league_key: string
          market_type_id?: string | null
          opening_line?: number | null
          opening_over_odds?: number | null
          opening_under_odds?: number | null
          participant_id?: string | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          refreshed_at?: string
          sport_key: string
          updated_at?: string
        }
        Update: {
          canonical_market_key?: string
          closing_line?: number | null
          closing_over_odds?: number | null
          closing_under_odds?: number | null
          created_at?: string
          current_line?: number | null
          current_over_odds?: number | null
          current_under_odds?: number | null
          event_id?: string | null
          fair_over_prob?: number | null
          fair_under_prob?: number | null
          id?: string
          is_stale?: boolean
          last_offer_snapshot_at?: string
          league_key?: string
          market_type_id?: string | null
          opening_line?: number | null
          opening_over_odds?: number | null
          opening_under_odds?: number | null
          participant_id?: string | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          refreshed_at?: string
          sport_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_universe_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_universe_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      member_tiers: {
        Row: {
          changed_by: string | null
          created_at: string
          discord_id: string
          discord_username: string | null
          effective_from: string
          effective_until: string | null
          id: string
          metadata: Json
          reason: string | null
          source: string
          tier: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          discord_id: string
          discord_username?: string | null
          effective_from?: string
          effective_until?: string | null
          id?: string
          metadata?: Json
          reason?: string | null
          source: string
          tier: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          discord_id?: string
          discord_username?: string | null
          effective_from?: string
          effective_until?: string | null
          id?: string
          metadata?: Json
          reason?: string | null
          source?: string
          tier?: string
        }
        Relationships: []
      }
      model_health_snapshots: {
        Row: {
          alert_level: string
          calibration_score: number | null
          created_at: string
          drift_score: number | null
          id: string
          market_family: string
          metadata: Json
          model_id: string
          roi: number | null
          sample_size: number
          snapshot_at: string
          sport: string
          win_rate: number | null
        }
        Insert: {
          alert_level?: string
          calibration_score?: number | null
          created_at?: string
          drift_score?: number | null
          id?: string
          market_family: string
          metadata?: Json
          model_id: string
          roi?: number | null
          sample_size?: number
          snapshot_at?: string
          sport: string
          win_rate?: number | null
        }
        Update: {
          alert_level?: string
          calibration_score?: number | null
          created_at?: string
          drift_score?: number | null
          id?: string
          market_family?: string
          metadata?: Json
          model_id?: string
          roi?: number | null
          sample_size?: number
          snapshot_at?: string
          sport?: string
          win_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "model_health_snapshots_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "model_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      model_registry: {
        Row: {
          active_state: string | null
          calibration_metadata: Json | null
          champion_since: string | null
          created_at: string
          id: string
          market_family: string
          metadata: Json
          model_name: string
          owner: string | null
          promotion_approved_at: string | null
          promotion_approved_by: string | null
          registry_entity_type: string | null
          source_type_compatibility: string[] | null
          sport: string
          status: string
          training_window_end: string | null
          training_window_start: string | null
          updated_at: string
          validation_metrics: Json | null
          version: string
        }
        Insert: {
          active_state?: string | null
          calibration_metadata?: Json | null
          champion_since?: string | null
          created_at?: string
          id?: string
          market_family: string
          metadata?: Json
          model_name: string
          owner?: string | null
          promotion_approved_at?: string | null
          promotion_approved_by?: string | null
          registry_entity_type?: string | null
          source_type_compatibility?: string[] | null
          sport: string
          status?: string
          training_window_end?: string | null
          training_window_start?: string | null
          updated_at?: string
          validation_metrics?: Json | null
          version: string
        }
        Update: {
          active_state?: string | null
          calibration_metadata?: Json | null
          champion_since?: string | null
          created_at?: string
          id?: string
          market_family?: string
          metadata?: Json
          model_name?: string
          owner?: string | null
          promotion_approved_at?: string | null
          promotion_approved_by?: string | null
          registry_entity_type?: string | null
          source_type_compatibility?: string[] | null
          sport?: string
          status?: string
          training_window_end?: string | null
          training_window_start?: string | null
          updated_at?: string
          validation_metrics?: Json | null
          version?: string
        }
        Relationships: []
      }
      odds_snapshot_corrections: {
        Row: {
          corrected_by: string
          created_at: string
          id: string
          new_snapshot_id: string
          reason: string
          snapshot_id: string
        }
        Insert: {
          corrected_by: string
          created_at?: string
          id?: string
          new_snapshot_id: string
          reason: string
          snapshot_id: string
        }
        Update: {
          corrected_by?: string
          created_at?: string
          id?: string
          new_snapshot_id?: string
          reason?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "odds_snapshot_corrections_new_snapshot_id_fkey"
            columns: ["new_snapshot_id"]
            isOneToOne: false
            referencedRelation: "odds_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odds_snapshot_corrections_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "odds_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      odds_snapshots: {
        Row: {
          created_at: string
          id: string
          league: string
          market_key: string
          price_blob: Json
          prior_snapshot_id: string | null
          provider_key: string
          raw_payload_id: string | null
          run_id: string
          snapshot_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          league: string
          market_key: string
          price_blob: Json
          prior_snapshot_id?: string | null
          provider_key: string
          raw_payload_id?: string | null
          run_id: string
          snapshot_at: string
        }
        Update: {
          created_at?: string
          id?: string
          league?: string
          market_key?: string
          price_blob?: Json
          prior_snapshot_id?: string | null
          provider_key?: string
          raw_payload_id?: string | null
          run_id?: string
          snapshot_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "odds_snapshots_prior_snapshot_id_fkey"
            columns: ["prior_snapshot_id"]
            isOneToOne: false
            referencedRelation: "odds_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odds_snapshots_raw_payload_id_fkey"
            columns: ["raw_payload_id"]
            isOneToOne: false
            referencedRelation: "raw_payloads"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_memberships: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          parent_participant_id: string
          participant_id: string
          role: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          parent_participant_id: string
          participant_id: string
          role?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          parent_participant_id?: string
          participant_id?: string
          role?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "participant_memberships_parent_participant_id_fkey"
            columns: ["parent_participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participant_memberships_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      participants: {
        Row: {
          created_at: string
          display_name: string
          external_id: string | null
          id: string
          league: string | null
          metadata: Json
          participant_type: string
          sport: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          external_id?: string | null
          id?: string
          league?: string | null
          metadata?: Json
          participant_type: string
          sport?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          external_id?: string | null
          id?: string
          league?: string | null
          metadata?: Json
          participant_type?: string
          sport?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pick_candidates: {
        Row: {
          created_at: string
          expires_at: string | null
          filter_details: Json | null
          id: string
          is_board_candidate: boolean
          model_confidence: number | null
          model_registry_id: string | null
          model_score: number | null
          model_tier: string | null
          ownership_timestamp: string | null
          pick_id: string | null
          provenance: Json | null
          rejection_reason: string | null
          scan_run_id: string | null
          scoring_run_id: string | null
          selection_rank: number | null
          shadow_mode: boolean
          sport_key: string | null
          status: string
          universe_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          filter_details?: Json | null
          id?: string
          is_board_candidate?: boolean
          model_confidence?: number | null
          model_registry_id?: string | null
          model_score?: number | null
          model_tier?: string | null
          ownership_timestamp?: string | null
          pick_id?: string | null
          provenance?: Json | null
          rejection_reason?: string | null
          scan_run_id?: string | null
          scoring_run_id?: string | null
          selection_rank?: number | null
          shadow_mode?: boolean
          sport_key?: string | null
          status?: string
          universe_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          filter_details?: Json | null
          id?: string
          is_board_candidate?: boolean
          model_confidence?: number | null
          model_registry_id?: string | null
          model_score?: number | null
          model_tier?: string | null
          ownership_timestamp?: string | null
          pick_id?: string | null
          provenance?: Json | null
          rejection_reason?: string | null
          scan_run_id?: string | null
          scoring_run_id?: string | null
          selection_rank?: number | null
          shadow_mode?: boolean
          sport_key?: string | null
          status?: string
          universe_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pick_candidates_model_registry_id_fkey"
            columns: ["model_registry_id"]
            isOneToOne: false
            referencedRelation: "model_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_candidates_scoring_run_id_fkey"
            columns: ["scoring_run_id"]
            isOneToOne: false
            referencedRelation: "system_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_candidates_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "market_universe"
            referencedColumns: ["id"]
          },
        ]
      }
      pick_lifecycle: {
        Row: {
          created_at: string
          from_state: string | null
          id: string
          payload: Json
          pick_id: string
          reason: string | null
          to_state: string
          writer_role: string
        }
        Insert: {
          created_at?: string
          from_state?: string | null
          id?: string
          payload?: Json
          pick_id: string
          reason?: string | null
          to_state: string
          writer_role: string
        }
        Update: {
          created_at?: string
          from_state?: string | null
          id?: string
          payload?: Json
          pick_id?: string
          reason?: string | null
          to_state?: string
          writer_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "pick_lifecycle_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "picks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_lifecycle_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "picks_current_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_lifecycle_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "v_governed_pick_performance"
            referencedColumns: ["pick_id"]
          },
        ]
      }
      pick_offer_snapshots: {
        Row: {
          bookmaker_key: string | null
          captured_at: string
          created_at: string
          devig_mode: string
          id: string
          identity_key: string
          line: number | null
          over_odds: number | null
          payload: Json
          pick_id: string
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          settlement_record_id: string | null
          snapshot_kind: string
          source_compact_snapshot_id: string | null
          source_current_identity_key: string | null
          source_run_id: string | null
          source_snapshot_at: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          captured_at: string
          created_at?: string
          devig_mode: string
          id?: string
          identity_key: string
          line?: number | null
          over_odds?: number | null
          payload?: Json
          pick_id: string
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          settlement_record_id?: string | null
          snapshot_kind: string
          source_compact_snapshot_id?: string | null
          source_current_identity_key?: string | null
          source_run_id?: string | null
          source_snapshot_at?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          captured_at?: string
          created_at?: string
          devig_mode?: string
          id?: string
          identity_key?: string
          line?: number | null
          over_odds?: number | null
          payload?: Json
          pick_id?: string
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          settlement_record_id?: string | null
          snapshot_kind?: string
          source_compact_snapshot_id?: string | null
          source_current_identity_key?: string | null
          source_run_id?: string | null
          source_snapshot_at?: string | null
          under_odds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pick_offer_snapshots_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "picks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_offer_snapshots_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "picks_current_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_offer_snapshots_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "v_governed_pick_performance"
            referencedColumns: ["pick_id"]
          },
          {
            foreignKeyName: "pick_offer_snapshots_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "sportsbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_offer_snapshots_settlement_record_id_fkey"
            columns: ["settlement_record_id"]
            isOneToOne: false
            referencedRelation: "settlement_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_offer_snapshots_settlement_record_id_fkey"
            columns: ["settlement_record_id"]
            isOneToOne: false
            referencedRelation: "v_governed_pick_performance"
            referencedColumns: ["settlement_id"]
          },
          {
            foreignKeyName: "pick_offer_snapshots_source_compact_snapshot_id_fkey"
            columns: ["source_compact_snapshot_id"]
            isOneToOne: false
            referencedRelation: "provider_offer_history_compact"
            referencedColumns: ["snapshot_id"]
          },
          {
            foreignKeyName: "pick_offer_snapshots_source_run_id_fkey"
            columns: ["source_run_id"]
            isOneToOne: false
            referencedRelation: "system_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      pick_promotion_history: {
        Row: {
          created_at: string
          decided_at: string
          decided_by: string
          id: string
          override_action: string | null
          payload: Json
          pick_id: string
          reason: string | null
          score: number | null
          status: string
          target: string
          version: string
        }
        Insert: {
          created_at?: string
          decided_at: string
          decided_by: string
          id?: string
          override_action?: string | null
          payload?: Json
          pick_id: string
          reason?: string | null
          score?: number | null
          status: string
          target: string
          version: string
        }
        Update: {
          created_at?: string
          decided_at?: string
          decided_by?: string
          id?: string
          override_action?: string | null
          payload?: Json
          pick_id?: string
          reason?: string | null
          score?: number | null
          status?: string
          target?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "pick_promotion_history_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "picks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_promotion_history_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "picks_current_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_promotion_history_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "v_governed_pick_performance"
            referencedColumns: ["pick_id"]
          },
        ]
      }
      pick_reviews: {
        Row: {
          created_at: string
          decided_at: string
          decided_by: string
          decision: string
          id: string
          pick_id: string
          reason: string
        }
        Insert: {
          created_at?: string
          decided_at?: string
          decided_by: string
          decision: string
          id?: string
          pick_id: string
          reason: string
        }
        Update: {
          created_at?: string
          decided_at?: string
          decided_by?: string
          decision?: string
          id?: string
          pick_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "pick_reviews_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "picks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_reviews_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "picks_current_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_reviews_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "v_governed_pick_performance"
            referencedColumns: ["pick_id"]
          },
        ]
      }
      picks: {
        Row: {
          approval_status: string
          capper_id: string | null
          confidence: number | null
          created_at: string
          id: string
          idempotency_key: string | null
          line: number | null
          market: string
          market_type_id: string | null
          metadata: Json
          odds: number | null
          participant_id: string | null
          player_id: string | null
          posted_at: string | null
          promotion_decided_at: string | null
          promotion_decided_by: string | null
          promotion_reason: string | null
          promotion_score: number | null
          promotion_status: string
          promotion_target: string | null
          promotion_version: string | null
          selection: string
          settled_at: string | null
          source: string
          sport_id: string | null
          stake_units: number | null
          status: string
          submission_id: string | null
          updated_at: string
        }
        Insert: {
          approval_status?: string
          capper_id?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          line?: number | null
          market: string
          market_type_id?: string | null
          metadata?: Json
          odds?: number | null
          participant_id?: string | null
          player_id?: string | null
          posted_at?: string | null
          promotion_decided_at?: string | null
          promotion_decided_by?: string | null
          promotion_reason?: string | null
          promotion_score?: number | null
          promotion_status?: string
          promotion_target?: string | null
          promotion_version?: string | null
          selection: string
          settled_at?: string | null
          source: string
          sport_id?: string | null
          stake_units?: number | null
          status?: string
          submission_id?: string | null
          updated_at?: string
        }
        Update: {
          approval_status?: string
          capper_id?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          line?: number | null
          market?: string
          market_type_id?: string | null
          metadata?: Json
          odds?: number | null
          participant_id?: string | null
          player_id?: string | null
          posted_at?: string | null
          promotion_decided_at?: string | null
          promotion_decided_by?: string | null
          promotion_reason?: string | null
          promotion_score?: number | null
          promotion_status?: string
          promotion_target?: string | null
          promotion_version?: string | null
          selection?: string
          settled_at?: string | null
          source?: string
          sport_id?: string | null
          stake_units?: number | null
          status?: string
          submission_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "picks_capper_id_fkey"
            columns: ["capper_id"]
            isOneToOne: false
            referencedRelation: "cappers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_market_type_id_fkey"
            columns: ["market_type_id"]
            isOneToOne: false
            referencedRelation: "market_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      player_team_assignments: {
        Row: {
          created_at: string
          effective_from: string | null
          effective_until: string | null
          id: string
          is_current: boolean
          league_id: string
          metadata: Json
          player_id: string
          source: string
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          effective_from?: string | null
          effective_until?: string | null
          id?: string
          is_current?: boolean
          league_id: string
          metadata?: Json
          player_id: string
          source?: string
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          effective_from?: string | null
          effective_until?: string | null
          id?: string
          is_current?: boolean
          league_id?: string
          metadata?: Json
          player_id?: string
          source?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_team_assignments_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "canonical_reference_bootstrap_summary"
            referencedColumns: ["league_id"]
          },
          {
            foreignKeyName: "player_team_assignments_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_team_assignments_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_team_assignments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          first_name: string | null
          id: string
          last_name: string | null
          metadata: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          metadata?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          metadata?: Json
          updated_at?: string
        }
        Relationships: []
      }
      provider_book_aliases: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          provider: string
          provider_book_key: string
          provider_display_name: string
          sportsbook_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          provider: string
          provider_book_key: string
          provider_display_name: string
          sportsbook_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          provider?: string
          provider_book_key?: string
          provider_display_name?: string
          sportsbook_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_book_aliases_sportsbook_id_fkey"
            columns: ["sportsbook_id"]
            isOneToOne: false
            referencedRelation: "sportsbooks"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_cycle_status: {
        Row: {
          affected_market_key: string | null
          affected_provider_key: string | null
          affected_sport_key: string | null
          created_at: string
          cycle_snapshot_at: string
          duplicate_count: number
          failure_category: string | null
          failure_scope: string | null
          freshness_status: string
          last_error: string | null
          league: string
          merged_count: number
          metadata: Json
          proof_status: string
          provider_key: string
          run_id: string
          stage_status: string
          staged_count: number
          updated_at: string
        }
        Insert: {
          affected_market_key?: string | null
          affected_provider_key?: string | null
          affected_sport_key?: string | null
          created_at?: string
          cycle_snapshot_at: string
          duplicate_count?: number
          failure_category?: string | null
          failure_scope?: string | null
          freshness_status?: string
          last_error?: string | null
          league: string
          merged_count?: number
          metadata?: Json
          proof_status?: string
          provider_key: string
          run_id: string
          stage_status: string
          staged_count?: number
          updated_at?: string
        }
        Update: {
          affected_market_key?: string | null
          affected_provider_key?: string | null
          affected_sport_key?: string | null
          created_at?: string
          cycle_snapshot_at?: string
          duplicate_count?: number
          failure_category?: string | null
          failure_scope?: string | null
          freshness_status?: string
          last_error?: string | null
          league?: string
          merged_count?: number
          metadata?: Json
          proof_status?: string
          provider_key?: string
          run_id?: string
          stage_status?: string
          staged_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_cycle_status_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "sportsbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_cycle_status_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "system_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_entity_aliases: {
        Row: {
          created_at: string
          entity_kind: string
          id: string
          metadata: Json
          participant_id: string | null
          player_id: string | null
          provider: string
          provider_display_name: string
          provider_entity_id: string | null
          provider_entity_key: string
          team_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_kind: string
          id?: string
          metadata?: Json
          participant_id?: string | null
          player_id?: string | null
          provider: string
          provider_display_name: string
          provider_entity_id?: string | null
          provider_entity_key: string
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_kind?: string
          id?: string
          metadata?: Json
          participant_id?: string | null
          player_id?: string | null
          provider?: string
          provider_display_name?: string
          provider_entity_id?: string | null
          provider_entity_key?: string
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_entity_aliases_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_entity_aliases_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_entity_aliases_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_market_aliases: {
        Row: {
          combo_stat_type_id: string | null
          created_at: string
          id: string
          market_type_id: string
          metadata: Json
          provider: string
          provider_display_name: string
          provider_market_key: string
          sport_id: string | null
          stat_type_id: string | null
          updated_at: string
        }
        Insert: {
          combo_stat_type_id?: string | null
          created_at?: string
          id?: string
          market_type_id: string
          metadata?: Json
          provider: string
          provider_display_name: string
          provider_market_key: string
          sport_id?: string | null
          stat_type_id?: string | null
          updated_at?: string
        }
        Update: {
          combo_stat_type_id?: string | null
          created_at?: string
          id?: string
          market_type_id?: string
          metadata?: Json
          provider?: string
          provider_display_name?: string
          provider_market_key?: string
          sport_id?: string | null
          stat_type_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_market_aliases_combo_stat_type_id_fkey"
            columns: ["combo_stat_type_id"]
            isOneToOne: false
            referencedRelation: "combo_stat_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_market_aliases_market_type_id_fkey"
            columns: ["market_type_id"]
            isOneToOne: false
            referencedRelation: "market_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_market_aliases_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_market_aliases_stat_type_id_fkey"
            columns: ["stat_type_id"]
            isOneToOne: false
            referencedRelation: "stat_types"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_offer_current: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          identity_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
          updated_at: string
        }
        Insert: {
          bookmaker_key?: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          identity_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
          updated_at?: string
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          identity_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_offer_current_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "sportsbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_offer_current_source_run_id_fkey"
            columns: ["source_run_id"]
            isOneToOne: false
            referencedRelation: "system_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_offer_history: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_offer_history_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "sportsbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_offer_history_source_run_id_fkey"
            columns: ["source_run_id"]
            isOneToOne: false
            referencedRelation: "system_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_offer_history_compact: {
        Row: {
          bookmaker_key: string | null
          change_reason: string
          changed_fields: Json
          created_at: string
          devig_mode: string
          idempotency_key: string
          identity_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          metadata: Json
          observed_at: string
          over_odds: number | null
          previous_snapshot_id: string | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          snapshot_id: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          change_reason: string
          changed_fields?: Json
          created_at?: string
          devig_mode: string
          idempotency_key: string
          identity_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          metadata?: Json
          observed_at?: string
          over_odds?: number | null
          previous_snapshot_id?: string | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          snapshot_id?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          change_reason?: string
          changed_fields?: Json
          created_at?: string
          devig_mode?: string
          idempotency_key?: string
          identity_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          metadata?: Json
          observed_at?: string
          over_odds?: number | null
          previous_snapshot_id?: string | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          snapshot_id?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_offer_history_compact_previous_snapshot_id_fkey"
            columns: ["previous_snapshot_id"]
            isOneToOne: false
            referencedRelation: "provider_offer_history_compact"
            referencedColumns: ["snapshot_id"]
          },
          {
            foreignKeyName: "provider_offer_history_compact_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "sportsbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_offer_history_compact_source_run_id_fkey"
            columns: ["source_run_id"]
            isOneToOne: false
            referencedRelation: "system_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_offer_history_p20260502: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260503: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260504: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260505: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260506: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260507: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260508: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260509: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260510: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260511: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260512: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260513: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260514: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260515: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260516: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260517: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260518: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260519: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260520: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260521: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260522: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260523: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260524: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260525: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260526: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260527: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260528: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260529: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260530: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260531: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260601: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260602: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260603: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260604: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260605: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260606: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260607: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260608: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260609: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260610: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260611: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260612: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260613: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260614: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260615: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260616: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260617: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260618: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260619: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260620: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260621: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260622: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260623: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260624: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260625: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260626: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260627: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260628: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260629: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_history_p20260630: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          source_run_id: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          source_run_id?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: []
      }
      provider_offer_line_snapshots: {
        Row: {
          bookmaker_key: string | null
          closing_line: number | null
          created_at: string
          high_line: number | null
          id: string
          low_line: number | null
          opening_line: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_count: number
          snapshot_date: string
          sport_key: string | null
          updated_at: string
        }
        Insert: {
          bookmaker_key?: string | null
          closing_line?: number | null
          created_at?: string
          high_line?: number | null
          id?: string
          low_line?: number | null
          opening_line?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_count?: number
          snapshot_date: string
          sport_key?: string | null
          updated_at?: string
        }
        Update: {
          bookmaker_key?: string | null
          closing_line?: number | null
          created_at?: string
          high_line?: number | null
          id?: string
          low_line?: number | null
          opening_line?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_count?: number
          snapshot_date?: string
          sport_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_offer_line_snapshots_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "sportsbooks"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_offer_staging: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          identity_key: string
          is_closing: boolean
          is_opening: boolean
          league: string
          line: number | null
          merge_error: string | null
          merge_status: string
          merged_at: string | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          run_id: string
          snapshot_at: string
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          identity_key: string
          is_closing?: boolean
          is_opening?: boolean
          league: string
          line?: number | null
          merge_error?: string | null
          merge_status?: string
          merged_at?: string | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          run_id: string
          snapshot_at: string
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          identity_key?: string
          is_closing?: boolean
          is_opening?: boolean
          league?: string
          line?: number | null
          merge_error?: string | null
          merge_status?: string
          merged_at?: string | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          run_id?: string
          snapshot_at?: string
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_offer_staging_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "sportsbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_offer_staging_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "system_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_offers_legacy_quarantine: {
        Row: {
          bookmaker_key: string | null
          created_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number | null
          over_odds: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string | null
          snapshot_at: string
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode: string
          id?: string
          idempotency_key: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id: string
          provider_key: string
          provider_market_key: string
          provider_participant_id?: string | null
          snapshot_at: string
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string
          devig_mode?: string
          id?: string
          idempotency_key?: string
          is_closing?: boolean
          is_opening?: boolean
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string
          provider_key?: string
          provider_market_key?: string
          provider_participant_id?: string | null
          snapshot_at?: string
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_offers_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "sportsbooks"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_payloads: {
        Row: {
          created_at: string
          id: string
          kind: string
          league: string
          payload: Json
          payload_hash: string
          provider_key: string
          run_id: string
          snapshot_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          league: string
          payload: Json
          payload_hash: string
          provider_key: string
          run_id: string
          snapshot_at: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          league?: string
          payload?: Json
          payload_hash?: string
          provider_key?: string
          run_id?: string
          snapshot_at?: string
        }
        Relationships: []
      }
      selection_types: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          id: string
          metadata: Json
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          id: string
          metadata?: Json
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          id?: string
          metadata?: Json
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      settlement_records: {
        Row: {
          confidence: string
          corrects_id: string | null
          created_at: string
          evidence_ref: string | null
          id: string
          notes: string | null
          payload: Json
          pick_id: string
          result: string | null
          review_reason: string | null
          settled_at: string
          settled_by: string | null
          source: string
          stake_units: number | null
          status: string
        }
        Insert: {
          confidence?: string
          corrects_id?: string | null
          created_at?: string
          evidence_ref?: string | null
          id?: string
          notes?: string | null
          payload?: Json
          pick_id: string
          result?: string | null
          review_reason?: string | null
          settled_at?: string
          settled_by?: string | null
          source: string
          stake_units?: number | null
          status?: string
        }
        Update: {
          confidence?: string
          corrects_id?: string | null
          created_at?: string
          evidence_ref?: string | null
          id?: string
          notes?: string | null
          payload?: Json
          pick_id?: string
          result?: string | null
          review_reason?: string | null
          settled_at?: string
          settled_by?: string | null
          source?: string
          stake_units?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_records_corrects_id_fkey"
            columns: ["corrects_id"]
            isOneToOne: false
            referencedRelation: "settlement_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_records_corrects_id_fkey"
            columns: ["corrects_id"]
            isOneToOne: false
            referencedRelation: "v_governed_pick_performance"
            referencedColumns: ["settlement_id"]
          },
          {
            foreignKeyName: "settlement_records_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "picks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_records_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "picks_current_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_records_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "v_governed_pick_performance"
            referencedColumns: ["pick_id"]
          },
        ]
      }
      sport_market_type_availability: {
        Row: {
          active: boolean
          created_at: string
          market_type_id: string
          metadata: Json
          sort_order: number
          sport_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          market_type_id: string
          metadata?: Json
          sort_order?: number
          sport_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          market_type_id?: string
          metadata?: Json
          sort_order?: number
          sport_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sport_market_type_availability_market_type_id_fkey"
            columns: ["market_type_id"]
            isOneToOne: false
            referencedRelation: "market_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sport_market_type_availability_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      sports: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          id: string
          metadata: Json
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          id: string
          metadata?: Json
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          id?: string
          metadata?: Json
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      sportsbooks: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          id: string
          metadata: Json
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          id: string
          metadata?: Json
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          id?: string
          metadata?: Json
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      stat_types: {
        Row: {
          active: boolean
          canonical_key: string
          created_at: string
          display_name: string
          id: string
          name: string
          short_label: string
          sort_order: number
          sport_id: string
        }
        Insert: {
          active?: boolean
          canonical_key: string
          created_at?: string
          display_name: string
          id?: string
          name: string
          short_label: string
          sort_order?: number
          sport_id: string
        }
        Update: {
          active?: boolean
          canonical_key?: string
          created_at?: string
          display_name?: string
          id?: string
          name?: string
          short_label?: string
          sort_order?: number
          sport_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stat_types_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_events: {
        Row: {
          created_at: string
          event_name: string
          id: string
          payload: Json
          submission_id: string
        }
        Insert: {
          created_at?: string
          event_name: string
          id?: string
          payload?: Json
          submission_id: string
        }
        Update: {
          created_at?: string
          event_name?: string
          id?: string
          payload?: Json
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_events_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          created_at: string
          external_id: string | null
          id: string
          payload: Json
          received_at: string
          source: string
          status: string
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          id?: string
          payload?: Json
          received_at?: string
          source: string
          status?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_id?: string | null
          id?: string
          payload?: Json
          received_at?: string
          source?: string
          status?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      syndicate_board: {
        Row: {
          board_rank: number
          board_run_id: string
          board_tier: string
          candidate_id: string
          created_at: string
          id: string
          market_type_id: string | null
          model_score: number
          sport_key: string
          updated_at: string
        }
        Insert: {
          board_rank: number
          board_run_id: string
          board_tier: string
          candidate_id: string
          created_at?: string
          id?: string
          market_type_id?: string | null
          model_score: number
          sport_key: string
          updated_at?: string
        }
        Update: {
          board_rank?: number
          board_run_id?: string
          board_tier?: string
          candidate_id?: string
          created_at?: string
          id?: string
          market_type_id?: string | null
          model_score?: number
          sport_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "syndicate_board_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "pick_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syndicate_board_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "sgo_replay_coverage"
            referencedColumns: ["candidate_id"]
          },
          {
            foreignKeyName: "syndicate_board_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "v_governed_pick_performance"
            referencedColumns: ["candidate_id"]
          },
        ]
      }
      system_runs: {
        Row: {
          actor: string | null
          created_at: string
          details: Json
          finished_at: string | null
          id: string
          idempotency_key: string | null
          run_type: string
          started_at: string
          status: string
        }
        Insert: {
          actor?: string | null
          created_at?: string
          details?: Json
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          run_type: string
          started_at?: string
          status?: string
        }
        Update: {
          actor?: string | null
          created_at?: string
          details?: Json
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          run_type?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          abbreviation: string | null
          active: boolean
          city: string | null
          created_at: string
          display_name: string
          id: string
          league_id: string
          metadata: Json
          short_name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          abbreviation?: string | null
          active?: boolean
          city?: string | null
          created_at?: string
          display_name: string
          id: string
          league_id: string
          metadata?: Json
          short_name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          abbreviation?: string | null
          active?: boolean
          city?: string | null
          created_at?: string
          display_name?: string
          id?: string
          league_id?: string
          metadata?: Json
          short_name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "canonical_reference_bootstrap_summary"
            referencedColumns: ["league_id"]
          },
          {
            foreignKeyName: "teams_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      canonical_reference_bootstrap_summary: {
        Row: {
          assigned_players_count: number | null
          league_id: string | null
          players_count: number | null
          sport_id: string | null
          teams_count: number | null
          unassigned_players_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leagues_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      current_certification_state: {
        Row: {
          created_at: string | null
          domain: Database["public"]["Enums"]["certification_domain"] | null
          evidence_sha: string | null
          expires_at: string | null
          id: string | null
          merge_sha: string | null
          predecessor_id: string | null
          program_id: string | null
          revocation_trigger:
            | Database["public"]["Enums"]["revocation_trigger"]
            | null
          status: Database["public"]["Enums"]["certification_status"] | null
          transition_reason: string | null
          transitioned_at: string | null
          transitioned_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certification_records_predecessor_id_fkey"
            columns: ["predecessor_id"]
            isOneToOne: false
            referencedRelation: "certification_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certification_records_predecessor_id_fkey"
            columns: ["predecessor_id"]
            isOneToOne: false
            referencedRelation: "current_certification_state"
            referencedColumns: ["id"]
          },
        ]
      }
      picks_current_state: {
        Row: {
          approval_status: string | null
          capper_display_name: string | null
          capper_id: string | null
          confidence: number | null
          created_at: string | null
          id: string | null
          idempotency_key: string | null
          line: number | null
          market: string | null
          market_type_display_name: string | null
          market_type_id: string | null
          metadata: Json | null
          odds: number | null
          participant_id: string | null
          posted_at: string | null
          promotion_decided_at: string | null
          promotion_decided_at_current: string | null
          promotion_decided_by: string | null
          promotion_reason: string | null
          promotion_score: number | null
          promotion_score_current: number | null
          promotion_status: string | null
          promotion_status_current: string | null
          promotion_target: string | null
          promotion_target_current: string | null
          promotion_version: string | null
          review_decided_at: string | null
          review_decided_by: string | null
          review_decision: string | null
          selection: string | null
          settled_at: string | null
          settlement_recorded_at: string | null
          settlement_result: string | null
          settlement_source: string | null
          settlement_status: string | null
          source: string | null
          sport_display_name: string | null
          sport_id: string | null
          stake_units: number | null
          status: string | null
          submission_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "picks_capper_id_fkey"
            columns: ["capper_id"]
            isOneToOne: false
            referencedRelation: "cappers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_market_type_id_fkey"
            columns: ["market_type_id"]
            isOneToOne: false
            referencedRelation: "market_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_offers: {
        Row: {
          bookmaker_key: string | null
          created_at: string | null
          devig_mode: string | null
          id: string | null
          idempotency_key: string | null
          is_closing: boolean | null
          is_opening: boolean | null
          line: number | null
          over_odds: number | null
          provider_event_id: string | null
          provider_key: string | null
          provider_market_key: string | null
          provider_participant_id: string | null
          snapshot_at: string | null
          sport_key: string | null
          under_odds: number | null
        }
        Insert: {
          bookmaker_key?: string | null
          created_at?: string | null
          devig_mode?: string | null
          id?: string | null
          idempotency_key?: string | null
          is_closing?: boolean | null
          is_opening?: boolean | null
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string | null
          provider_key?: string | null
          provider_market_key?: string | null
          provider_participant_id?: string | null
          snapshot_at?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Update: {
          bookmaker_key?: string | null
          created_at?: string | null
          devig_mode?: string | null
          id?: string | null
          idempotency_key?: string | null
          is_closing?: boolean | null
          is_opening?: boolean | null
          line?: number | null
          over_odds?: number | null
          provider_event_id?: string | null
          provider_key?: string | null
          provider_market_key?: string | null
          provider_participant_id?: string | null
          snapshot_at?: string | null
          sport_key?: string | null
          under_odds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_offers_provider_key_fkey"
            columns: ["provider_key"]
            isOneToOne: false
            referencedRelation: "sportsbooks"
            referencedColumns: ["id"]
          },
        ]
      }
      sgo_replay_coverage: {
        Row: {
          candidate_id: string | null
          has_closing: boolean | null
          has_mu_closing: boolean | null
          has_mu_opening: boolean | null
          has_opening: boolean | null
          has_po_closing: boolean | null
          has_po_opening: boolean | null
          is_board_candidate: boolean | null
          model_score: number | null
          model_tier: string | null
          pick_id: string | null
          provider_event_id: string | null
          provider_key: string | null
          provider_market_key: string | null
          replay_eligible: boolean | null
          sport_key: string | null
          status: string | null
        }
        Relationships: []
      }
      v_governed_pick_performance: {
        Row: {
          board_model_score: number | null
          board_rank: number | null
          board_run_id: string | null
          board_tier: string | null
          candidate_id: string | null
          candidate_model_score: number | null
          market: string | null
          market_type_id: string | null
          metadata: Json | null
          model_confidence: number | null
          model_tier: string | null
          odds: number | null
          pick_created_at: string | null
          pick_id: string | null
          pick_status: string | null
          provider_key: string | null
          provider_market_key: string | null
          selection: string | null
          selection_rank: number | null
          settled_at: string | null
          settled_by: string | null
          settlement_confidence: string | null
          settlement_id: string | null
          settlement_result: string | null
          settlement_settled_at: string | null
          settlement_status: string | null
          sport_key: string | null
          universe_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pick_candidates_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "market_universe"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      awaiting_approval_drift_state: {
        Args: { stale_threshold?: string }
        Returns: {
          age_hours: number
          created_at: string
          has_validated_to_awaiting: boolean
          latest_lifecycle_at: string
          latest_lifecycle_to_state: string
          market: string
          pick_id: string
          selection: string
          source: string
          stale: boolean
        }[]
      }
      backfill_pick_awaiting_approval: {
        Args: { p_linear_issue: string; p_pick_id: string }
        Returns: Json
      }
      bootstrap_canonical_reference_data: { Args: never; Returns: undefined }
      claim_next_outbox: {
        Args: { p_target: string; p_worker_id: string }
        Returns: Json
      }
      confirm_delivery_atomic: {
        Args: {
          p_audit_action: string
          p_audit_payload: Json
          p_lifecycle_from_state: string
          p_lifecycle_reason: string
          p_lifecycle_to_state: string
          p_lifecycle_writer_role: string
          p_outbox_id: string
          p_pick_id: string
          p_receipt_channel: string
          p_receipt_external_id: string
          p_receipt_idempotency_key: string
          p_receipt_payload: Json
          p_receipt_status: string
          p_receipt_type: string
          p_worker_id: string
        }
        Returns: Json
      }
      drop_old_provider_offer_history_partitions: {
        Args: { p_retention_days?: number }
        Returns: {
          cutoff_date: string
          partitions_dropped: number
        }[]
      }
      drop_provider_offer_history_partitions_before: {
        Args: { p_cutoff_day: string }
        Returns: {
          dropped: boolean
          dropped_partition: string
        }[]
      }
      enqueue_distribution_atomic: {
        Args: {
          p_from_state: string
          p_lifecycle_created_at: string
          p_outbox_idempotency_key: string
          p_outbox_payload: Json
          p_outbox_target: string
          p_pick_id: string
          p_reason: string
          p_to_state: string
          p_writer_role: string
        }
        Returns: Json
      }
      ensure_provider_offer_history_partition: {
        Args: { p_day: string }
        Returns: string
      }
      ensure_provider_offer_history_partitions: {
        Args: { p_end_day: string; p_start_day: string }
        Returns: {
          partition_name: string
        }[]
      }
      list_provider_offer_current_opening: {
        Args: { p_limit: number; p_provider_key: string; p_since: string }
        Returns: {
          bookmaker_key: string
          created_at: string
          cycle_affected_market_key: string
          cycle_affected_provider_key: string
          cycle_affected_sport_key: string
          cycle_failure_category: string
          cycle_failure_scope: string
          cycle_freshness_status: string
          cycle_proof_status: string
          cycle_run_id: string
          cycle_stage_status: string
          cycle_updated_at: string
          devig_mode: string
          id: string
          idempotency_key: string
          is_closing: boolean
          is_opening: boolean
          line: number
          over_odds: number
          provider_event_id: string
          provider_health_state: string
          provider_key: string
          provider_market_key: string
          provider_participant_id: string
          snapshot_at: string
          sport_key: string
          under_odds: number
        }[]
      }
      merge_provider_offer_staging_cycle: {
        Args: {
          p_identity_strategy: string
          p_max_rows: number
          p_run_id: string
        }
        Returns: {
          duplicate_count: number
          merged_count: number
          processed_count: number
        }[]
      }
      process_submission_atomic: {
        Args: {
          p_event: Json
          p_idempotency_key?: string
          p_lifecycle_event?: Json
          p_pick: Json
          p_submission: Json
        }
        Returns: Json
      }
      prune_provider_offers_bounded: {
        Args: {
          p_batch_size?: number
          p_max_batches?: number
          p_retention_days?: number
        }
        Returns: {
          batches_run: number
          cutoff: string
          deleted_rows: number
          remaining_rows: number
        }[]
      }
      run_awaiting_approval_drift_monitor: {
        Args: { stale_threshold?: string }
        Returns: Json
      }
      settle_pick_atomic: {
        Args: {
          p_audit_action: string
          p_audit_actor: string
          p_audit_payload: Json
          p_lifecycle_from_state: string
          p_lifecycle_reason: string
          p_lifecycle_to_state: string
          p_lifecycle_writer_role: string
          p_pick_id: string
          p_settlement: Json
        }
        Returns: Json
      }
      summarize_provider_offer_history_partition: {
        Args: { p_date: string }
        Returns: {
          rows_summarized: number
          snapshot_date: string
        }[]
      }
      transition_pick_lifecycle: {
        Args: {
          p_from_state: string
          p_payload?: Json
          p_pick_id: string
          p_reason: string
          p_to_state: string
          p_writer_role: string
        }
        Returns: Json
      }
    }
    Enums: {
      certification_domain:
        | "replay"
        | "invariant"
        | "divergence"
        | "quarantine"
        | "proof_lineage"
        | "freshness"
        | "cert_evidence"
      certification_status:
        | "pending"
        | "active"
        | "suspended"
        | "revoked"
        | "expired"
      revocation_trigger:
        | "replay_nondeterminism"
        | "invariant_gap"
        | "proof_corruption"
        | "divergence_leakage"
        | "quarantine_bypass"
        | "stale_replay_acceptance"
        | "evidence_invalidation"
        | "dependency_revoked"
        | "manual_governance"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      certification_domain: [
        "replay",
        "invariant",
        "divergence",
        "quarantine",
        "proof_lineage",
        "freshness",
        "cert_evidence",
      ],
      certification_status: [
        "pending",
        "active",
        "suspended",
        "revoked",
        "expired",
      ],
      revocation_trigger: [
        "replay_nondeterminism",
        "invariant_gap",
        "proof_corruption",
        "divergence_leakage",
        "quarantine_bypass",
        "stale_replay_acceptance",
        "evidence_invalidation",
        "dependency_revoked",
        "manual_governance",
      ],
    },
  },
} as const
