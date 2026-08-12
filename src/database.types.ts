export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
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
      booking_packages: {
        Row: {
          amount_cents: number
          cadence_weeks: number | null
          coach_id: string
          consumer_id: string
          created_at: string
          expires_at: string | null
          id: string
          offer_type: string
          reschedule_until: string | null
          service_id: string
          status: string
          terms_snapshot: Json
          total_sessions: number
          used_sessions: number
        }
        Insert: {
          amount_cents: number
          cadence_weeks?: number | null
          coach_id: string
          consumer_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          offer_type?: string
          reschedule_until?: string | null
          service_id: string
          status?: string
          terms_snapshot?: Json
          total_sessions: number
          used_sessions?: number
        }
        Update: {
          amount_cents?: number
          cadence_weeks?: number | null
          coach_id?: string
          consumer_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          offer_type?: string
          reschedule_until?: string | null
          service_id?: string
          status?: string
          terms_snapshot?: Json
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
      booking_requests: {
        Row: {
          booking_id: string | null
          coach_id: string
          consumer_id: string
          created_at: string
          decided_at: string | null
          expires_at: string
          id: string
          package_id: string | null
          reason_code: string | null
          series_id: string | null
          status: string
        }
        Insert: {
          booking_id?: string | null
          coach_id: string
          consumer_id: string
          created_at?: string
          decided_at?: string | null
          expires_at: string
          id?: string
          package_id?: string | null
          reason_code?: string | null
          series_id?: string | null
          status?: string
        }
        Update: {
          booking_id?: string | null
          coach_id?: string
          consumer_id?: string
          created_at?: string
          decided_at?: string | null
          expires_at?: string
          id?: string
          package_id?: string | null
          reason_code?: string | null
          series_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_requests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requests_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "booking_requests_consumer_id_fkey"
            columns: ["consumer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requests_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: true
            referencedRelation: "booking_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requests_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: true
            referencedRelation: "booking_series"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_series: {
        Row: {
          cadence_weeks: number | null
          coach_id: string
          consumer_id: string
          created_at: string
          hold_expires_at: string | null
          id: string
          package_id: string
          service_id: string
          session_count: number
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          cadence_weeks?: number | null
          coach_id: string
          consumer_id: string
          created_at?: string
          hold_expires_at?: string | null
          id?: string
          package_id: string
          service_id: string
          session_count: number
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          cadence_weeks?: number | null
          coach_id?: string
          consumer_id?: string
          created_at?: string
          hold_expires_at?: string | null
          id?: string
          package_id?: string
          service_id?: string
          session_count?: number
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_series_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "booking_series_consumer_id_fkey"
            columns: ["consumer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_series_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: true
            referencedRelation: "booking_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_series_service_id_fkey"
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
          completed_at: string | null
          consumer_id: string
          created_at: string
          ends_at: string
          id: string
          meeting_provider: string
          notes: string
          outcome_finalized_at: string | null
          outcome_status: string | null
          outcome_window_ends_at: string | null
          package_id: string | null
          platform_fee_cents: number
          request_expires_at: string | null
          series_id: string | null
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
          completed_at?: string | null
          consumer_id: string
          created_at?: string
          ends_at: string
          id?: string
          meeting_provider?: string
          notes?: string
          outcome_finalized_at?: string | null
          outcome_status?: string | null
          outcome_window_ends_at?: string | null
          package_id?: string | null
          platform_fee_cents: number
          request_expires_at?: string | null
          series_id?: string | null
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
          completed_at?: string | null
          consumer_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          meeting_provider?: string
          notes?: string
          outcome_finalized_at?: string | null
          outcome_status?: string | null
          outcome_window_ends_at?: string | null
          package_id?: string | null
          platform_fee_cents?: number
          request_expires_at?: string | null
          series_id?: string | null
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
            foreignKeyName: "bookings_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "booking_series"
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
      coach_profiles: {
        Row: {
          bio: string
          city: string | null
          created_at: string
          custom_video_url: string | null
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
          created_at?: string
          custom_video_url?: string | null
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
          created_at?: string
          custom_video_url?: string | null
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
      coach_response_samples: {
        Row: {
          coach_id: string
          conversation_id: string
          created_at: string
          first_coach_response_at: string
          first_customer_message_at: string
          response_minutes: number
        }
        Insert: {
          coach_id: string
          conversation_id: string
          created_at?: string
          first_coach_response_at: string
          first_customer_message_at: string
          response_minutes: number
        }
        Update: {
          coach_id?: string
          conversation_id?: string
          created_at?: string
          first_coach_response_at?: string
          first_customer_message_at?: string
          response_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "coach_response_samples_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "coach_response_samples_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_services: {
        Row: {
          acceptance_window_hours: number
          active: boolean
          booking_mode: string
          cadence_weeks: number | null
          category_id: string | null
          coach_id: string
          description: string
          duration_minutes: number
          expiry_days: number | null
          id: string
          mode: Database["public"]["Enums"]["service_mode"]
          name: string
          offer_type: string
          package_size: number
          price_cents: number
          recurring_schedule_mode: string
        }
        Insert: {
          acceptance_window_hours?: number
          active?: boolean
          booking_mode?: string
          cadence_weeks?: number | null
          category_id?: string | null
          coach_id: string
          description?: string
          duration_minutes: number
          expiry_days?: number | null
          id?: string
          mode: Database["public"]["Enums"]["service_mode"]
          name: string
          offer_type?: string
          package_size?: number
          price_cents: number
          recurring_schedule_mode?: string
        }
        Update: {
          acceptance_window_hours?: number
          active?: boolean
          booking_mode?: string
          cadence_weeks?: number | null
          category_id?: string | null
          coach_id?: string
          description?: string
          duration_minutes?: number
          expiry_days?: number | null
          id?: string
          mode?: Database["public"]["Enums"]["service_mode"]
          name?: string
          offer_type?: string
          package_size?: number
          price_cents?: number
          recurring_schedule_mode?: string
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
      lifecycle_jobs: {
        Row: {
          attempts: number
          available_at: string
          completed_at: string | null
          created_at: string
          entity_id: string
          id: number
          kind: string
          last_error: string | null
          locked_at: string | null
          payload: Json
          status: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          entity_id: string
          id?: never
          kind: string
          last_error?: string | null
          locked_at?: string | null
          payload?: Json
          status?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          entity_id?: string
          id?: never
          kind?: string
          last_error?: string | null
          locked_at?: string | null
          payload?: Json
          status?: string
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
          authorization_expires_at: string | null
          booking_id: string | null
          capture_method: string
          coach_id: string
          consumer_id: string
          created_at: string
          currency: string
          id: string
          idempotency_key: string | null
          package_id: string | null
          platform_fee_cents: number
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          stripe_refund_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          authorization_expires_at?: string | null
          booking_id?: string | null
          capture_method?: string
          coach_id: string
          consumer_id: string
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string | null
          package_id?: string | null
          platform_fee_cents: number
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          authorization_expires_at?: string | null
          booking_id?: string | null
          capture_method?: string
          coach_id?: string
          consumer_id?: string
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string | null
          package_id?: string | null
          platform_fee_cents?: number
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
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
          city: string | null
          created_at: string
          display_name: string
          id: string
          locale: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          city?: string | null
          created_at?: string
          display_name: string
          id: string
          locale?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          city?: string | null
          created_at?: string
          display_name?: string
          id?: string
          locale?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
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
      reputation_summaries: {
        Row: {
          completed_sessions: number
          late_cancellations: number
          median_response_minutes: number | null
          no_shows: number
          profile_id: string
          reliability_percent: number | null
          review_count: number
          role: Database["public"]["Enums"]["user_role"]
          star_rating: number | null
          unique_reviewers: number
          updated_at: string
        }
        Insert: {
          completed_sessions?: number
          late_cancellations?: number
          median_response_minutes?: number | null
          no_shows?: number
          profile_id: string
          reliability_percent?: number | null
          review_count?: number
          role: Database["public"]["Enums"]["user_role"]
          star_rating?: number | null
          unique_reviewers?: number
          updated_at?: string
        }
        Update: {
          completed_sessions?: number
          late_cancellations?: number
          median_response_minutes?: number | null
          no_shows?: number
          profile_id?: string
          reliability_percent?: number | null
          review_count?: number
          role?: Database["public"]["Enums"]["user_role"]
          star_rating?: number | null
          unique_reviewers?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reputation_summaries_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      review_replies: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          moderation_status: string
          review_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          moderation_status?: string
          review_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          moderation_status?: string
          review_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_replies_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_replies_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: true
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          author_id: string
          booking_id: string
          coach_id: string
          comment: string
          commitment: number | null
          communication: number | null
          consumer_id: string
          created_at: string
          id: string
          moderation_status: string
          personalization: number | null
          published: boolean
          punctuality: number | null
          quality: number | null
          rating: number
          respect: number | null
          reveal_after: string
          revealed_at: string | null
          safety: number | null
          subject_id: string
          target_role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          author_id: string
          booking_id: string
          coach_id: string
          comment?: string
          commitment?: number | null
          communication?: number | null
          consumer_id: string
          created_at?: string
          id?: string
          moderation_status?: string
          personalization?: number | null
          published?: boolean
          punctuality?: number | null
          quality?: number | null
          rating: number
          respect?: number | null
          reveal_after?: string
          revealed_at?: string | null
          safety?: number | null
          subject_id: string
          target_role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          author_id?: string
          booking_id?: string
          coach_id?: string
          comment?: string
          commitment?: number | null
          communication?: number | null
          consumer_id?: string
          created_at?: string
          id?: string
          moderation_status?: string
          personalization?: number | null
          published?: boolean
          punctuality?: number | null
          quality?: number | null
          rating?: number
          respect?: number | null
          reveal_after?: string
          revealed_at?: string | null
          safety?: number | null
          subject_id?: string
          target_role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
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
          {
            foreignKeyName: "reviews_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      session_credits: {
        Row: {
          booking_id: string | null
          coach_id: string
          consumer_id: string
          created_at: string
          expires_at: string
          id: string
          ordinal: number
          package_id: string | null
          service_id: string
          source_booking_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          coach_id: string
          consumer_id: string
          created_at?: string
          expires_at: string
          id?: string
          ordinal: number
          package_id?: string | null
          service_id: string
          source_booking_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          coach_id?: string
          consumer_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          ordinal?: number
          package_id?: string | null
          service_id?: string
          source_booking_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_credits_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_credits_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "session_credits_consumer_id_fkey"
            columns: ["consumer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_credits_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "booking_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_credits_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "coach_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_credits_source_booking_id_fkey"
            columns: ["source_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      session_reports: {
        Row: {
          author_id: string
          booking_id: string
          circumstances: string[]
          created_at: string
          id: string
          note: string
          outcome: string
          response_due_at: string
          updated_at: string
        }
        Insert: {
          author_id: string
          booking_id: string
          circumstances?: string[]
          created_at?: string
          id?: string
          note?: string
          outcome: string
          response_due_at?: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          booking_id?: string
          circumstances?: string[]
          created_at?: string
          id?: string
          note?: string
          outcome?: string
          response_due_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_reports_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_reports_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_training_lifecycle: { Args: never; Returns: Json }
      claim_lifecycle_job: { Args: never; Returns: Json }
      create_package_booking: {
        Args: {
          p_consumer_id: string
          p_meeting_provider?: string
          p_package_id: string
          p_starts_at: string
        }
        Returns: {
          amount_cents: number
          coach_id: string
          completed_at: string | null
          consumer_id: string
          created_at: string
          ends_at: string
          id: string
          meeting_provider: string
          notes: string
          outcome_finalized_at: string | null
          outcome_status: string | null
          outcome_window_ends_at: string | null
          package_id: string | null
          platform_fee_cents: number
          request_expires_at: string | null
          series_id: string | null
          service_id: string
          starts_at: string
          status: Database["public"]["Enums"]["booking_status"]
          stripe_payment_intent_id: string | null
          updated_at: string
          video_url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
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
        Returns: {
          amount_cents: number
          coach_id: string
          completed_at: string | null
          consumer_id: string
          created_at: string
          ends_at: string
          id: string
          meeting_provider: string
          notes: string
          outcome_finalized_at: string | null
          outcome_status: string | null
          outcome_window_ends_at: string | null
          package_id: string | null
          platform_fee_cents: number
          request_expires_at: string | null
          series_id: string | null
          service_id: string
          starts_at: string
          status: Database["public"]["Enums"]["booking_status"]
          stripe_payment_intent_id: string | null
          updated_at: string
          video_url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_recurring_package_hold: {
        Args: {
          p_consumer_id: string
          p_meeting_provider?: string
          p_service_id: string
          p_starts_at: string[]
          p_timezone?: string
        }
        Returns: Json
      }
      finish_lifecycle_job: {
        Args: { p_error?: string; p_job_id: number }
        Returns: boolean
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
  graphql_public: {
    Enums: {},
  },
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
