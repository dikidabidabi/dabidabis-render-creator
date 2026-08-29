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
      cloud_backups: {
        Row: {
          byte_size: number
          sketch_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          byte_size?: number
          sketch_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          byte_size?: number
          sketch_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      direct_messages: {
        Row: {
          body: string | null
          created_at: string
          from_user: string
          id: string
          read_at: string | null
          shared_post_id: string | null
          shared_render_id: string | null
          to_user: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          from_user: string
          id?: string
          read_at?: string | null
          shared_post_id?: string | null
          shared_render_id?: string | null
          to_user: string
        }
        Update: {
          body?: string | null
          created_at?: string
          from_user?: string
          id?: string
          read_at?: string | null
          shared_post_id?: string | null
          shared_render_id?: string | null
          to_user?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_messages_shared_post_id_fkey"
            columns: ["shared_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_shared_render_id_fkey"
            columns: ["shared_render_id"]
            isOneToOne: false
            referencedRelation: "renders"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_seen: {
        Row: {
          last_seen_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          last_seen_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      formula_settings: {
        Row: {
          data: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          data?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          data?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      post_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_likes: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          body: string | null
          created_at: string
          data_link: string | null
          id: string
          image_url: string | null
          kind: string
          project_address: string | null
          project_lat: number | null
          project_lon: number | null
          repost_of_post: string | null
          repost_of_render: string | null
          sketch_source: string | null
          sketch_title: string | null
          sketch_url: string | null
          tender_deadline: string | null
          tender_title: string | null
          tor_url: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          data_link?: string | null
          id?: string
          image_url?: string | null
          kind?: string
          project_address?: string | null
          project_lat?: number | null
          project_lon?: number | null
          repost_of_post?: string | null
          repost_of_render?: string | null
          sketch_source?: string | null
          sketch_title?: string | null
          sketch_url?: string | null
          tender_deadline?: string | null
          tender_title?: string | null
          tor_url?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          data_link?: string | null
          id?: string
          image_url?: string | null
          kind?: string
          project_address?: string | null
          project_lat?: number | null
          project_lon?: number | null
          repost_of_post?: string | null
          repost_of_render?: string | null
          sketch_source?: string | null
          sketch_title?: string | null
          sketch_url?: string | null
          tender_deadline?: string | null
          tender_title?: string | null
          tor_url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_repost_of_post_fkey"
            columns: ["repost_of_post"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_repost_of_render_fkey"
            columns: ["repost_of_render"]
            isOneToOne: false
            referencedRelation: "renders"
            referencedColumns: ["id"]
          },
        ]
      }
      presentation_notes: {
        Row: {
          author: string
          created_at: string
          id: string
          share_id: string
          slide_id: string
          slide_title: string | null
          strokes: Json
          texts: Json
          updated_at: string
        }
        Insert: {
          author: string
          created_at?: string
          id?: string
          share_id: string
          slide_id: string
          slide_title?: string | null
          strokes?: Json
          texts?: Json
          updated_at?: string
        }
        Update: {
          author?: string
          created_at?: string
          id?: string
          share_id?: string
          slide_id?: string
          slide_title?: string | null
          strokes?: Json
          texts?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "presentation_notes_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "shared_presentations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_type: string | null
          avatar_url: string | null
          bio: string | null
          corporate_code: string | null
          corporate_parent_code: string | null
          created_at: string
          display_name: string | null
          id: string
          professional_level: string | null
          qualifications: string | null
          updated_at: string
        }
        Insert: {
          account_type?: string | null
          avatar_url?: string | null
          bio?: string | null
          corporate_code?: string | null
          corporate_parent_code?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          professional_level?: string | null
          qualifications?: string | null
          updated_at?: string
        }
        Update: {
          account_type?: string | null
          avatar_url?: string | null
          bio?: string | null
          corporate_code?: string | null
          corporate_parent_code?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          professional_level?: string | null
          qualifications?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      render_comment_reactions: {
        Row: {
          comment_id: string
          created_at: string
          emoji: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          emoji: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          emoji?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "render_comment_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "render_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      render_comment_seen: {
        Row: {
          last_seen_at: string
          render_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          render_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          last_seen_at?: string
          render_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "render_comment_seen_render_id_fkey"
            columns: ["render_id"]
            isOneToOne: false
            referencedRelation: "renders"
            referencedColumns: ["id"]
          },
        ]
      }
      render_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          parent_id: string | null
          render_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          parent_id?: string | null
          render_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          render_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "render_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "render_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "render_comments_render_id_fkey"
            columns: ["render_id"]
            isOneToOne: false
            referencedRelation: "renders"
            referencedColumns: ["id"]
          },
        ]
      }
      render_likes: {
        Row: {
          created_at: string
          render_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          render_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          render_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "render_likes_render_id_fkey"
            columns: ["render_id"]
            isOneToOne: false
            referencedRelation: "renders"
            referencedColumns: ["id"]
          },
        ]
      }
      renders: {
        Row: {
          accuracy: number
          consistency: number
          created_at: string
          error: string | null
          id: string
          prompt: string
          reference_url: string | null
          render_type: string
          result_url: string | null
          sketch_url: string | null
          status: string
          user_id: string
        }
        Insert: {
          accuracy?: number
          consistency?: number
          created_at?: string
          error?: string | null
          id?: string
          prompt: string
          reference_url?: string | null
          render_type: string
          result_url?: string | null
          sketch_url?: string | null
          status?: string
          user_id: string
        }
        Update: {
          accuracy?: number
          consistency?: number
          created_at?: string
          error?: string | null
          id?: string
          prompt?: string
          reference_url?: string | null
          render_type?: string
          result_url?: string | null
          sketch_url?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      shared_presentations: {
        Row: {
          created_at: string
          from_user: string
          id: string
          payload: Json
          title: string
          to_user: string
        }
        Insert: {
          created_at?: string
          from_user: string
          id?: string
          payload?: Json
          title: string
          to_user: string
        }
        Update: {
          created_at?: string
          from_user?: string
          id?: string
          payload?: Json
          title?: string
          to_user?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_share: {
        Args: { _share_id: string; _user_id: string }
        Returns: boolean
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
