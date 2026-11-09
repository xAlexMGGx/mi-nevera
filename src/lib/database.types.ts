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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      catalog_items: {
        Row: {
          category: Database["public"]["Enums"]["category"]
          created_at: string
          default_content_amount: number | null
          default_content_unit:
            | Database["public"]["Enums"]["amount_unit"]
            | null
          default_quantity_kind: Database["public"]["Enums"]["quantity_kind"]
          default_unit_label: string
          default_zone: Database["public"]["Enums"]["zone_kind"]
          icon: string
          id: string
          name_en: string
          name_es: string
          slug: string
          synonyms_en: string[]
          synonyms_es: string[]
          updated_at: string
        }
        Insert: {
          category: Database["public"]["Enums"]["category"]
          created_at?: string
          default_content_amount?: number | null
          default_content_unit?:
            | Database["public"]["Enums"]["amount_unit"]
            | null
          default_quantity_kind: Database["public"]["Enums"]["quantity_kind"]
          default_unit_label: string
          default_zone: Database["public"]["Enums"]["zone_kind"]
          icon: string
          id?: string
          name_en: string
          name_es: string
          slug: string
          synonyms_en?: string[]
          synonyms_es?: string[]
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["category"]
          created_at?: string
          default_content_amount?: number | null
          default_content_unit?:
            | Database["public"]["Enums"]["amount_unit"]
            | null
          default_quantity_kind?: Database["public"]["Enums"]["quantity_kind"]
          default_unit_label?: string
          default_zone?: Database["public"]["Enums"]["zone_kind"]
          icon?: string
          id?: string
          name_en?: string
          name_es?: string
          slug?: string
          synonyms_en?: string[]
          synonyms_es?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      date_samples: {
        Row: {
          created_at: string
          days_to_printed_date: number
          house_id: string
          id: string
          printed_date_type: Database["public"]["Enums"]["printed_date_type"]
          product_id: string
        }
        Insert: {
          created_at?: string
          days_to_printed_date: number
          house_id: string
          id?: string
          printed_date_type: Database["public"]["Enums"]["printed_date_type"]
          product_id: string
        }
        Update: {
          created_at?: string
          days_to_printed_date?: number
          house_id?: string
          id?: string
          printed_date_type?: Database["public"]["Enums"]["printed_date_type"]
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "date_samples_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_samples_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      house_members: {
        Row: {
          house_id: string
          joined_at: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          house_id: string
          joined_at?: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          house_id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "house_members_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
        ]
      }
      houses: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      lots: {
        Row: {
          barcode: string | null
          brand: string | null
          container_number: number | null
          cooked_at: string | null
          created_at: string
          frozen_at: string | null
          house_id: string
          id: string
          image_url: string | null
          opened_at: string | null
          printed_date: string | null
          printed_date_type:
            | Database["public"]["Enums"]["printed_date_type"]
            | null
          product_id: string
          purchased_at: string
          quantity: number
          reminder_date: string | null
          source: Database["public"]["Enums"]["lot_source"]
          thawed_at: string | null
          updated_at: string
          zone_id: string
        }
        Insert: {
          barcode?: string | null
          brand?: string | null
          container_number?: number | null
          cooked_at?: string | null
          created_at?: string
          frozen_at?: string | null
          house_id: string
          id?: string
          image_url?: string | null
          opened_at?: string | null
          printed_date?: string | null
          printed_date_type?:
            | Database["public"]["Enums"]["printed_date_type"]
            | null
          product_id: string
          purchased_at?: string
          quantity: number
          reminder_date?: string | null
          source?: Database["public"]["Enums"]["lot_source"]
          thawed_at?: string | null
          updated_at?: string
          zone_id: string
        }
        Update: {
          barcode?: string | null
          brand?: string | null
          container_number?: number | null
          cooked_at?: string | null
          created_at?: string
          frozen_at?: string | null
          house_id?: string
          id?: string
          image_url?: string | null
          opened_at?: string | null
          printed_date?: string | null
          printed_date_type?:
            | Database["public"]["Enums"]["printed_date_type"]
            | null
          product_id?: string
          purchased_at?: string
          quantity?: number
          reminder_date?: string | null
          source?: Database["public"]["Enums"]["lot_source"]
          thawed_at?: string | null
          updated_at?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lots_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lots_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      movements: {
        Row: {
          catalog_item_id: string | null
          created_at: string
          details: Json
          house_id: string
          id: string
          lot_ids: string[]
          product_id: string | null
          product_name: string
          seq: number
          type: Database["public"]["Enums"]["movement_type"]
          undo_state: Json
        }
        Insert: {
          catalog_item_id?: string | null
          created_at?: string
          details?: Json
          house_id: string
          id?: string
          lot_ids?: string[]
          product_id?: string | null
          product_name: string
          seq?: never
          type: Database["public"]["Enums"]["movement_type"]
          undo_state?: Json
        }
        Update: {
          catalog_item_id?: string | null
          created_at?: string
          details?: Json
          house_id?: string
          id?: string
          lot_ids?: string[]
          product_id?: string | null
          product_name?: string
          seq?: never
          type?: Database["public"]["Enums"]["movement_type"]
          undo_state?: Json
        }
        Relationships: [
          {
            foreignKeyName: "movements_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      opened_units: {
        Row: {
          created_at: string
          house_id: string
          id: string
          lot_id: string
          opened_at: string
          remaining_fraction: number
          reminder_date: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          house_id: string
          id?: string
          lot_id: string
          opened_at: string
          remaining_fraction?: number
          reminder_date?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          house_id?: string
          id?: string
          lot_id?: string
          opened_at?: string
          remaining_fraction?: number
          reminder_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opened_units_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opened_units_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opened_units_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lots_with_dates"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand_notes: string | null
          bulk_unit: Database["public"]["Enums"]["amount_unit"] | null
          catalog_item_id: string | null
          category: Database["public"]["Enums"]["category"]
          content_amount: number | null
          content_unit: Database["public"]["Enums"]["amount_unit"] | null
          created_at: string
          house_id: string
          icon: string | null
          id: string
          image_url: string | null
          kind: Database["public"]["Enums"]["product_kind"]
          name: string
          name_customized: boolean
          name_normalized: string | null
          preferred_brand: string | null
          quantity_kind: Database["public"]["Enums"]["quantity_kind"]
          unit_label: string
          updated_at: string
        }
        Insert: {
          brand_notes?: string | null
          bulk_unit?: Database["public"]["Enums"]["amount_unit"] | null
          catalog_item_id?: string | null
          category: Database["public"]["Enums"]["category"]
          content_amount?: number | null
          content_unit?: Database["public"]["Enums"]["amount_unit"] | null
          created_at?: string
          house_id: string
          icon?: string | null
          id?: string
          image_url?: string | null
          kind?: Database["public"]["Enums"]["product_kind"]
          name: string
          name_customized?: boolean
          name_normalized?: string | null
          preferred_brand?: string | null
          quantity_kind: Database["public"]["Enums"]["quantity_kind"]
          unit_label: string
          updated_at?: string
        }
        Update: {
          brand_notes?: string | null
          bulk_unit?: Database["public"]["Enums"]["amount_unit"] | null
          catalog_item_id?: string | null
          category?: Database["public"]["Enums"]["category"]
          content_amount?: number | null
          content_unit?: Database["public"]["Enums"]["amount_unit"] | null
          created_at?: string
          house_id?: string
          icon?: string | null
          id?: string
          image_url?: string | null
          kind?: Database["public"]["Enums"]["product_kind"]
          name?: string
          name_customized?: boolean
          name_normalized?: string | null
          preferred_brand?: string | null
          quantity_kind?: Database["public"]["Enums"]["quantity_kind"]
          unit_label?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_house_id: string | null
          created_at: string
          display_name: string
          id: string
          locale: string
          notify_days_ahead: number
          notify_enabled: boolean
          notify_hour: number
          recipe_preferences: string
          timezone: string
          updated_at: string
        }
        Insert: {
          active_house_id?: string | null
          created_at?: string
          display_name?: string
          id: string
          locale?: string
          notify_days_ahead?: number
          notify_enabled?: boolean
          notify_hour?: number
          recipe_preferences?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          active_house_id?: string | null
          created_at?: string
          display_name?: string
          id?: string
          locale?: string
          notify_days_ahead?: number
          notify_enabled?: boolean
          notify_hour?: number
          recipe_preferences?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_house_id_fkey"
            columns: ["active_house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
        ]
      }
      zones: {
        Row: {
          created_at: string
          house_id: string
          id: string
          kind: Database["public"]["Enums"]["zone_kind"]
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          house_id: string
          id?: string
          kind: Database["public"]["Enums"]["zone_kind"]
          sort_order: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          house_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["zone_kind"]
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "zones_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      lots_with_dates: {
        Row: {
          barcode: string | null
          brand: string | null
          container_number: number | null
          cooked_at: string | null
          created_at: string | null
          effective_basis: string | null
          effective_date: string | null
          frozen_at: string | null
          house_id: string | null
          id: string | null
          image_url: string | null
          opened_at: string | null
          printed_date: string | null
          printed_date_type:
            | Database["public"]["Enums"]["printed_date_type"]
            | null
          product_id: string | null
          purchased_at: string | null
          quantity: number | null
          reminder_date: string | null
          source: Database["public"]["Enums"]["lot_source"] | null
          thawed_at: string | null
          updated_at: string | null
          zone_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lots_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lots_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      opened_units_with_dates: {
        Row: {
          created_at: string | null
          effective_basis: string | null
          effective_date: string | null
          house_id: string | null
          id: string | null
          lot_id: string | null
          opened_at: string | null
          remaining_fraction: number | null
          reminder_date: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opened_units_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opened_units_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opened_units_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lots_with_dates"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_cooked_dish: {
        Args: {
          p_container_number?: number
          p_cooked_at?: string
          p_house_id: string
          p_name: string
          p_reminder_date?: string
          p_servings: number
          p_source?: Database["public"]["Enums"]["lot_source"]
          p_zone_id: string
        }
        Returns: string
      }
      add_lot: {
        Args: {
          p_brand?: string
          p_bulk_unit?: Database["public"]["Enums"]["amount_unit"]
          p_catalog_item_id?: string
          p_category?: Database["public"]["Enums"]["category"]
          p_content_amount?: number
          p_content_unit?: Database["public"]["Enums"]["amount_unit"]
          p_frozen_at?: string
          p_house_id: string
          p_name?: string
          p_printed_date?: string
          p_printed_date_type?: Database["public"]["Enums"]["printed_date_type"]
          p_product_id?: string
          p_purchased_at?: string
          p_quantity: number
          p_quantity_kind?: Database["public"]["Enums"]["quantity_kind"]
          p_reminder_date?: string
          p_source?: Database["public"]["Enums"]["lot_source"]
          p_unit_label?: string
          p_zone_id: string
        }
        Returns: string
      }
      adjust_quantity: {
        Args: { p_lot_id: string; p_new_quantity: number }
        Returns: string
      }
      consume: {
        Args: {
          p_all?: boolean
          p_amount?: number
          p_lot_id?: string
          p_product_id?: string
          p_zone_id?: string
        }
        Returns: string
      }
      create_house: { Args: { p_name: string }; Returns: string }
      delete_product: { Args: { p_product_id: string }; Returns: undefined }
      discard: {
        Args: {
          p_lot_id: string
          p_opened_unit_ids?: string[]
          p_quantity?: number
        }
        Returns: string
      }
      move_lot: {
        Args: {
          p_lot_id: string
          p_opened_unit_ids?: string[]
          p_quantity: number
          p_reminder_date?: string
          p_target_zone_id: string
        }
        Returns: string
      }
      next_container_number: { Args: { p_house_id: string }; Returns: number }
      open_unit: {
        Args: {
          p_lot_id?: string
          p_product_id?: string
          p_reminder_date?: string
        }
        Returns: string
      }
      set_remaining: {
        Args: { p_fraction: number; p_opened_unit_id: string }
        Returns: string
      }
      undo_movement: { Args: { p_movement_id: string }; Returns: undefined }
      update_lot: { Args: { p_lot_id: string; p_patch: Json }; Returns: string }
      update_opened_unit: {
        Args: { p_opened_unit_id: string; p_patch: Json }
        Returns: string
      }
      update_product: {
        Args: { p_patch: Json; p_product_id: string }
        Returns: undefined
      }
    }
    Enums: {
      amount_unit: "g" | "kg" | "ml" | "l" | "ud"
      category:
        | "dairy_eggs"
        | "meat"
        | "fish"
        | "fruit"
        | "vegetables"
        | "bread"
        | "pasta_rice_legumes"
        | "canned"
        | "frozen"
        | "drinks"
        | "sauces"
        | "snacks"
        | "breakfast"
        | "cooked"
        | "other"
      lot_source: "manual" | "ticket" | "barcode" | "recipe" | "move"
      member_role: "owner" | "editor"
      movement_type:
        | "added"
        | "consumed"
        | "opened"
        | "adjusted"
        | "finished"
        | "moved_zone"
        | "moved_out"
        | "moved_in"
        | "frozen"
        | "thawed"
        | "discarded"
        | "cooked"
        | "ticket_applied"
      printed_date_type: "expiry" | "best_before"
      product_kind: "food" | "cooked_dish"
      quantity_kind: "count" | "divisible" | "bulk"
      zone_kind: "fridge" | "freezer" | "pantry"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      amount_unit: ["g", "kg", "ml", "l", "ud"],
      category: [
        "dairy_eggs",
        "meat",
        "fish",
        "fruit",
        "vegetables",
        "bread",
        "pasta_rice_legumes",
        "canned",
        "frozen",
        "drinks",
        "sauces",
        "snacks",
        "breakfast",
        "cooked",
        "other",
      ],
      lot_source: ["manual", "ticket", "barcode", "recipe", "move"],
      member_role: ["owner", "editor"],
      movement_type: [
        "added",
        "consumed",
        "opened",
        "adjusted",
        "finished",
        "moved_zone",
        "moved_out",
        "moved_in",
        "frozen",
        "thawed",
        "discarded",
        "cooked",
        "ticket_applied",
      ],
      printed_date_type: ["expiry", "best_before"],
      product_kind: ["food", "cooked_dish"],
      quantity_kind: ["count", "divisible", "bulk"],
      zone_kind: ["fridge", "freezer", "pantry"],
    },
  },
} as const
