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
    PostgrestVersion: "14.4"
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
      model_registry: {
        Row: {
          champion_since: string | null
          created_at: string
          id: string
          market_family: string
          metadata: Json
          model_name: string
          sport: string
          status: string
          updated_at: string
          version: string
        }
        Insert: {
          champion_since?: string | null
          created_at?: string
          id?: string
          market_family: string
          metadata?: Json
          model_name: string
          sport: string
          status?: string
          updated_at?: string
          version: string
        }
        Update: {
          champion_since?: string | null
          created_at?: string
          id?: string
          market_family?: string
          metadata?: Json
          model_name?: string
          sport?: string
          status?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
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
        ]
      }
      picks: {
        Row: {
          approval_status: string
          confidence: number | null
          created_at: string
          id: string
          idempotency_key: string | null
          line: number | null
          market: string
          metadata: Json
          odds: number | null
          participant_id: string | null
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
          stake_units: number | null
          status: string
          submission_id: string | null
          updated_at: string
        }
        Insert: {
          approval_status?: string
          confidence?: number | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          line?: number | null
          market: string
          metadata?: Json
          odds?: number | null
          participant_id?: string | null
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
          stake_units?: number | null
          status?: string
          submission_id?: string | null
          updated_at?: string
        }
        Update: {
          approval_status?: string
          confidence?: number | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          line?: number | null
          market?: string
          metadata?: Json
          odds?: number | null
          participant_id?: string | null
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
          stake_units?: number | null
          status?: string
          submission_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "picks_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
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
      provider_offers: {
        Row: {
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
            foreignKeyName: "settlement_records_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "picks"
            referencedColumns: ["id"]
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
      sport_market_types: {
        Row: {
          created_at: string
          id: string
          market_type: string
          sort_order: number
          sport_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          market_type: string
          sort_order?: number
          sport_id: string
        }
        Update: {
          created_at?: string
          id?: string
          market_type?: string
          sort_order?: number
          sport_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sport_market_types_sport_id_fkey"
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
    }
    Functions: {
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
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
