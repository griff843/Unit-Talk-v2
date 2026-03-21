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
      picks: {
        Row: {
          approval_status: string
          confidence: number | null
          created_at: string
          id: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
