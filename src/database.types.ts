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
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: number
          metadata: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: never
          metadata?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_exceptions: {
        Row: {
          available: boolean
          coach_id: string
          ends_at: string
          id: string
          label: string
          starts_at: string
        }
        Insert: {
          available?: boolean
          coach_id: string
          ends_at: string
          id?: string
          label?: string
          starts_at: string
        }
        Update: {
          available?: boolean
          coach_id?: string
          ends_at?: string
          id?: string
          label?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_exceptions_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      availability_rules: {
        Row: {
          coach_id: string
          ends_at: string
          id: string
          starts_at: string
          timezone: string
          weekday: number
        }
        Insert: {
          coach_id: string
          ends_at: string
          id?: string
          starts_at: string
          timezone?: string
          weekday: number
        }
        Update: {
          coach_id?: string
          ends_at?: string
          id?: string
          starts_at?: string
          timezone?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      booking_packages: {
        Row: {
          amount_cents: number
          coach_id: string
          consumer_id: string
          created_at: string
          id: string
          service_id: string
          status: string
          total_sessions: number
          used_sessions: number
        }
        Insert: {
          amount_cents: number
          coach_id: string
          consumer_id: string
          created_at?: string
          id?: string
          service_id: string
          status?: string
          total_sessions: number
          used_sessions?: number
        }
        Update: {
          amount_cents?: number
          coach_id?: string
          consumer_id?: string
          created_at?: string
          id?: string
          service_id?: string
          status?: string
          total_sessions?: number
          used_sessions?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_packages_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "booking_packages_consumer_id_fkey"
            columns: ["consumer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_packages_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "coach_services"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          amount_cents: number
          coach_id: string
          consumer_id: string
          created_at: string
          ends_at: string
          id: string
          meeting_provider: string
          notes: string
          package_id: string | null
          platform_fee_cents: number
          service_id: string
          starts_at: string
          status: Database["public"]["Enums"]["booking_status"]
          stripe_payment_intent_id: string | null
          updated_at: string
          video_url: string | null
        }
        Insert: {
          amount_cents: number
          coach_id: string
          consumer_id: string
          created_at?: string
          ends_at: string
          id?: string
          meeting_provider?: string
          notes?: string
          package_id?: string | null
          platform_fee_cents: number
          service_id: string
          starts_at: string
          status?: Database["public"]["Enums"]["booking_status"]
          stripe_payment_intent_id?: string | null
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          amount_cents?: number
          coach_id?: string
          consumer_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          meeting_provider?: string
          notes?: string
          package_id?: string | null
          platform_fee_cents?: number
          service_id?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["booking_status"]
          stripe_payment_intent_id?: string | null
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bookings_consumer_id_fkey"
            columns: ["consumer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "booking_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "coach_services"
            referencedColumns: ["id"]
          },
        ]
      }
      cancellations: {
        Row: {
          booking_id: string
          cancelled_by: string
          created_at: string
          id: string
          reason: string
          refund_cents: number
        }
        Insert: {
          booking_id: string
          cancelled_by: string
          created_at?: string
          id?: string
          reason?: string
          refund_cents?: number
        }
        Update: {
          booking_id?: string
          cancelled_by?: string
          created_at?: string
          id?: string
          reason?: string
          refund_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "cancellations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancellations_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          active: boolean
          id: string
          name_en: string
          name_es: string
          parent_id: string | null
          slug: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          id?: string
          name_en: string
          name_es: string
          parent_id?: string | null
          slug: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          id?: string
          name_en?: string
          name_es?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_users: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocked_users_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_users_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_profiles: {
        Row: {
          bio: string
          city: string | null
          custom_video_url: string | null
          created_at: string
          headline: string
          languages: string[]
          latitude: number | null
          longitude: number | null
          mode: Database["public"]["Enums"]["service_mode"]
          preferred_video_provider: string
          rating: number
          responds_now: boolean
          review_count: number
          stripe_account_id: string | null
          travel_radius_km: number | null
          updated_at: string
          user_id: string
          verification_note: string | null
          verification_status: Database["public"]["Enums"]["verification_status"]
          video_path: string | null
          video_review_note: string | null
          video_status: string
          years_experience: number
        }
        Insert: {
          bio?: string
          city?: string | null
          custom_video_url?: string | null
          created_at?: string
          headline?: string
          languages?: string[]
          latitude?: number | null
          longitude?: number | null
          mode?: Database["public"]["Enums"]["service_mode"]
          preferred_video_provider?: string
          rating?: number
          responds_now?: boolean
          review_count?: number
          stripe_account_id?: string | null
          travel_radius_km?: number | null
          updated_at?: string
          user_id: string
          verification_note?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
          video_path?: string | null
          video_review_note?: string | null
          video_status?: string
          years_experience?: number
        }
        Update: {
          bio?: string
          city?: string | null
          custom_video_url?: string | null
          created_at?: string
          headline?: string
          languages?: string[]
          latitude?: number | null
          longitude?: number | null
          mode?: Database["public"]["Enums"]["service_mode"]
          preferred_video_provider?: string
          rating?: number
          responds_now?: boolean
          review_count?: number
          stripe_account_id?: string | null
          travel_radius_km?: number | null
          updated_at?: string
          user_id?: string
          verification_note?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
          video_path?: string | null
          video_review_note?: string | null
          video_status?: string
          years_experience?: number
        }
        Relationships: [
          {
            foreignKeyName: "coach_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_services: {
        Row: {
          active: boolean
          category_id: string | null
          coach_id: string
          description: string
          duration_minutes: number
          id: string
          mode: Database["public"]["Enums"]["service_mode"]
          name: string
          package_size: number
          price_cents: number
        }
        Insert: {
          active?: boolean
          category_id?: string | null
          coach_id: string
          description?: string
          duration_minutes: number
          id?: string
          mode: Database["public"]["Enums"]["service_mode"]
          name: string
          package_size?: number
          price_cents: number
        }
        Update: {
          active?: boolean
          category_id?: string | null
          coach_id?: string
          description?: string
          duration_minutes?: number
          id?: string
          mode?: Database["public"]["Enums"]["service_mode"]
          name?: string
          package_size?: number
          price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "coach_services_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_services_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      conversations: {
        Row: {
          booking_id: string | null
          coach_id: string
          consumer_id: string
          created_at: string
          id: string
          last_message_at: string
        }
        Insert: {
          booking_id?: string | null
          coach_id: string
          consumer_id: string
          created_at?: string
          id?: string
          last_message_at?: string
        }
        Update: {
          booking_id?: string | null
          coach_id?: string
          consumer_id?: string
          created_at?: string
          id?: string
          last_message_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "conversations_consumer_id_fkey"
            columns: ["consumer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      credential_documents: {
        Row: {
          coach_id: string
          created_at: string
          id: string
          kind: string
          review_note: string | null
          reviewed_at: string | null
          status: string
          storage_path: string
          title: string
        }
        Insert: {
          coach_id: string
          created_at?: string
          id?: string
          kind?: string
          review_note?: string | null
          reviewed_at?: string | null
          status?: string
          storage_path: string
          title: string
        }
        Update: {
          coach_id?: string
          created_at?: string
          id?: string
          kind?: string
          review_note?: string | null
          reviewed_at?: string | null
          status?: string
          storage_path?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "credential_documents_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      integration_connections: {
        Row: {
          created_at: string
          encrypted_access_token: string | null
          encrypted_refresh_token: string | null
          expires_at: string | null
          id: string
          metadata: Json
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          encrypted_access_token?: string | null
          encrypted_refresh_token?: string | null
          expires_at?: string | null
          id?: string
          metadata?: Json
          provider: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          encrypted_access_token?: string | null
          encrypted_refresh_token?: string | null
          expires_at?: string | null
          id?: string
          metadata?: Json
          provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_path: string | null
          body: string
          conversation_id: string
          created_at: string
          id: string
          read_at: string | null
          reported_at: string | null
          sender_id: string
        }
        Insert: {
          attachment_path?: string | null
          body?: string
          conversation_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          reported_at?: string | null
          sender_id: string
        }
        Update: {
          attachment_path?: string | null
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          reported_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          body: string
          created_at: string
          id: string
          kind: string
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          action_url?: string | null
          body?: string
          created_at?: string
          id?: string
          kind: string
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          action_url?: string | null
          body?: string
          created_at?: string
          id?: string
          kind?: string
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          booking_id: string | null
          coach_id: string
          consumer_id: string
          created_at: string
          currency: string
          id: string
          package_id: string | null
          platform_fee_cents: number
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          booking_id?: string | null
          coach_id: string
          consumer_id: string
          created_at?: string
          currency?: string
          id?: string
          package_id?: string | null
          platform_fee_cents: number
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          booking_id?: string | null
          coach_id?: string
          consumer_id?: string
          created_at?: string
          currency?: string
          id?: string
          package_id?: string | null
          platform_fee_cents?: number
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payments_consumer_id_fkey"
            columns: ["consumer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: true
            referencedRelation: "booking_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          locale: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          locale?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          locale?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      matching_settings: {
        Row: {
          availability_weight: number
          goal_weight: number
          id: number
          mode_weight: number
          reputation_weight: number
          specialty_weight: number
          updated_at: string
        }
        Insert: {
          availability_weight?: number
          goal_weight?: number
          id?: number
          mode_weight?: number
          reputation_weight?: number
          specialty_weight?: number
          updated_at?: string
        }
        Update: {
          availability_weight?: number
          goal_weight?: number
          id?: number
          mode_weight?: number
          reputation_weight?: number
          specialty_weight?: number
          updated_at?: string
        }
        Relationships: []
      }
      stripe_webhook_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          processed_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id: string
          processed_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          processed_at?: string | null
          status?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          conversation_id: string | null
          created_at: string
          details: string
          id: string
          message_id: string | null
          reason: string
          reported_user_id: string | null
          reporter_id: string
          status: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          details?: string
          id?: string
          message_id?: string | null
          reason: string
          reported_user_id?: string | null
          reporter_id: string
          status?: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          details?: string
          id?: string
          message_id?: string | null
          reason?: string
          reported_user_id?: string | null
          reporter_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reported_user_id_fkey"
            columns: ["reported_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          booking_id: string
          coach_id: string
          comment: string
          consumer_id: string
          created_at: string
          id: string
          published: boolean
          rating: number
        }
        Insert: {
          booking_id: string
          coach_id: string
          comment?: string
          consumer_id: string
          created_at?: string
          id?: string
          published?: boolean
          rating: number
        }
        Update: {
          booking_id?: string
          coach_id?: string
          comment?: string
          consumer_id?: string
          created_at?: string
          id?: string
          published?: boolean
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reviews_consumer_id_fkey"
            columns: ["consumer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_package_booking: {
        Args: {
          p_consumer_id: string
          p_meeting_provider?: string
          p_package_id: string
          p_starts_at: string
        }
        Returns: Database["public"]["Tables"]["bookings"]["Row"]
      }
      create_pending_booking: {
        Args: {
          p_consumer_id: string
          p_meeting_provider?: string
          p_notes?: string
          p_platform_fee_percent?: number
          p_service_id: string
          p_starts_at: string
        }
        Returns: Database["public"]["Tables"]["bookings"]["Row"]
      }
    }
    Enums: {
      booking_status:
        | "pending_payment"
        | "confirmed"
        | "cancelled"
        | "completed"
        | "disputed"
        | "refunded"
      service_mode: "online" | "presencial" | "hibrido"
      user_role: "consumer" | "coach" | "admin"
      verification_status:
        | "draft"
        | "credentials_submitted"
        | "under_review"
        | "verified"
        | "rejected"
        | "suspended"
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
      booking_status: [
        "pending_payment",
        "confirmed",
        "cancelled",
        "completed",
        "disputed",
        "refunded",
      ],
      service_mode: ["online", "presencial", "hibrido"],
      user_role: ["consumer", "coach", "admin"],
      verification_status: [
        "draft",
        "credentials_submitted",
        "under_review",
        "verified",
        "rejected",
        "suspended",
      ],
    },
  },
} as const

