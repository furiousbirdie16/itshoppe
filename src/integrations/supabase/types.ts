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
      activity_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          user_email: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          user_email?: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          user_email?: string
          user_id?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
      document_sequences: {
        Row: {
          id: string
          next_number: number
          padding: number
          prefix: string
        }
        Insert: {
          id: string
          next_number?: number
          padding?: number
          prefix: string
        }
        Update: {
          id?: string
          next_number?: number
          padding?: number
          prefix?: string
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          created_at: string | null
          id: string
          item_id: string
          notes: string | null
          quantity: number
          reference_id: string | null
          reference_type: string | null
          type: Database["public"]["Enums"]["movement_type"]
        }
        Insert: {
          created_at?: string | null
          id?: string
          item_id: string
          notes?: string | null
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          type: Database["public"]["Enums"]["movement_type"]
        }
        Update: {
          created_at?: string | null
          id?: string
          item_id?: string
          notes?: string | null
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          type?: Database["public"]["Enums"]["movement_type"]
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          id: string
          invoice_id: string
          item_id: string | null
          item_name: string | null
          quantity: number
          unit_price: number
          variation_id: string | null
        }
        Insert: {
          id?: string
          invoice_id: string
          item_id?: string | null
          item_name?: string | null
          quantity?: number
          unit_price?: number
          variation_id?: string | null
        }
        Update: {
          id?: string
          invoice_id?: string
          item_id?: string | null
          item_name?: string | null
          quantity?: number
          unit_price?: number
          variation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_variation_id_fkey"
            columns: ["variation_id"]
            isOneToOne: false
            referencedRelation: "item_variations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string | null
          customer_id: string | null
          due_date: string | null
          id: string
          invoice_date: string | null
          invoice_number: string
          notes: string | null
          quotation_id: string | null
          sales_agent: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number: string
          notes?: string | null
          quotation_id?: string | null
          sales_agent?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string
          notes?: string | null
          quotation_id?: string | null
          sales_agent?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      item_variations: {
        Row: {
          created_at: string
          factor: number
          id: string
          item_id: string
          name: string
          selling_price: number
          sku: string | null
          type: Database["public"]["Enums"]["variation_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          factor?: number
          id?: string
          item_id: string
          name: string
          selling_price?: number
          sku?: string | null
          type: Database["public"]["Enums"]["variation_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          factor?: number
          id?: string
          item_id?: string
          name?: string
          selling_price?: number
          sku?: string | null
          type?: Database["public"]["Enums"]["variation_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_variations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          base_unit: string
          cost_price: number
          cost_price_rmb: number
          created_at: string | null
          description: string | null
          id: string
          low_stock_threshold: number | null
          name: string
          open_roll_remaining: number
          quantity: number
          selling_price: number
          sku: string
          source: string
          store_quantity: number
          units_per_stock: number
          updated_at: string | null
          warehouse_quantity: number
        }
        Insert: {
          base_unit?: string
          cost_price?: number
          cost_price_rmb?: number
          created_at?: string | null
          description?: string | null
          id?: string
          low_stock_threshold?: number | null
          name: string
          open_roll_remaining?: number
          quantity?: number
          selling_price?: number
          sku: string
          source?: string
          store_quantity?: number
          units_per_stock?: number
          updated_at?: string | null
          warehouse_quantity?: number
        }
        Update: {
          base_unit?: string
          cost_price?: number
          cost_price_rmb?: number
          created_at?: string | null
          description?: string | null
          id?: string
          low_stock_threshold?: number | null
          name?: string
          open_roll_remaining?: number
          quantity?: number
          selling_price?: number
          sku?: string
          source?: string
          store_quantity?: number
          units_per_stock?: number
          updated_at?: string | null
          warehouse_quantity?: number
        }
        Relationships: []
      }
      manual_receivables: {
        Row: {
          amount: number
          created_at: string
          customer_id: string | null
          description: string
          due_date: string | null
          id: string
          notes: string
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          customer_id?: string | null
          description?: string
          due_date?: string | null
          id?: string
          notes?: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          customer_id?: string | null
          description?: string
          due_date?: string | null
          id?: string
          notes?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_receivables_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      online_sales: {
        Row: {
          amount_paid: number
          created_at: string | null
          deal_price: number
          id: string
          item_id: string | null
          notes: string | null
          order_date: string
          order_number: string
          paid_at: string | null
          payment_status: string
          posted_price: number
          product_name: string
          quantity: number
          sales_channel: Database["public"]["Enums"]["sales_channel"]
          status: Database["public"]["Enums"]["online_sale_status"]
          updated_at: string | null
          variation_id: string | null
        }
        Insert: {
          amount_paid?: number
          created_at?: string | null
          deal_price?: number
          id?: string
          item_id?: string | null
          notes?: string | null
          order_date?: string
          order_number: string
          paid_at?: string | null
          payment_status?: string
          posted_price?: number
          product_name: string
          quantity?: number
          sales_channel: Database["public"]["Enums"]["sales_channel"]
          status?: Database["public"]["Enums"]["online_sale_status"]
          updated_at?: string | null
          variation_id?: string | null
        }
        Update: {
          amount_paid?: number
          created_at?: string | null
          deal_price?: number
          id?: string
          item_id?: string | null
          notes?: string | null
          order_date?: string
          order_number?: string
          paid_at?: string | null
          payment_status?: string
          posted_price?: number
          product_name?: string
          quantity?: number
          sales_channel?: Database["public"]["Enums"]["sales_channel"]
          status?: Database["public"]["Enums"]["online_sale_status"]
          updated_at?: string | null
          variation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "online_sales_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_sales_variation_id_fkey"
            columns: ["variation_id"]
            isOneToOne: false
            referencedRelation: "item_variations"
            referencedColumns: ["id"]
          },
        ]
      }
      overseas_purchase_order_items: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          item_id: string | null
          item_name: string
          po_id: string
          quantity: number
          received_date: string | null
          received_quantity: number
          unit_cost: number
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          item_id?: string | null
          item_name: string
          po_id: string
          quantity?: number
          received_date?: string | null
          received_quantity?: number
          unit_cost?: number
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          item_id?: string | null
          item_name?: string
          po_id?: string
          quantity?: number
          received_date?: string | null
          received_quantity?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "overseas_purchase_order_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overseas_purchase_order_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "overseas_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      overseas_purchase_orders: {
        Row: {
          created_at: string | null
          currency: string
          exchange_rate: number
          expected_delivery: string | null
          id: string
          notes: string | null
          order_date: string | null
          po_number: string
          status: string
          supplier_id: string | null
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string
          exchange_rate?: number
          expected_delivery?: string | null
          id?: string
          notes?: string | null
          order_date?: string | null
          po_number: string
          status?: string
          supplier_id?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string
          exchange_rate?: number
          expected_delivery?: string | null
          id?: string
          notes?: string | null
          order_date?: string | null
          po_number?: string
          status?: string
          supplier_id?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "overseas_purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "overseas_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      overseas_suppliers: {
        Row: {
          address: string | null
          contact_person: string | null
          country: string | null
          created_at: string | null
          currency: string
          email: string | null
          exchange_rate: number
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          country?: string | null
          created_at?: string | null
          currency?: string
          email?: string | null
          exchange_rate?: number
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          country?: string | null
          created_at?: string | null
          currency?: string
          email?: string | null
          exchange_rate?: number
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      purchase_order_items: {
        Row: {
          id: string
          item_id: string | null
          item_name: string | null
          po_id: string
          quantity: number
          received_date: string | null
          received_quantity: number
          unit_cost: number
        }
        Insert: {
          id?: string
          item_id?: string | null
          item_name?: string | null
          po_id: string
          quantity?: number
          received_date?: string | null
          received_quantity?: number
          unit_cost?: number
        }
        Update: {
          id?: string
          item_id?: string | null
          item_name?: string | null
          po_id?: string
          quantity?: number
          received_date?: string | null
          received_quantity?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string | null
          expected_delivery: string | null
          id: string
          notes: string | null
          order_date: string | null
          payment_due_date: string | null
          payment_terms: number | null
          po_number: string
          status: Database["public"]["Enums"]["po_status"]
          supplier_id: string | null
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          expected_delivery?: string | null
          id?: string
          notes?: string | null
          order_date?: string | null
          payment_due_date?: string | null
          payment_terms?: number | null
          po_number: string
          status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          expected_delivery?: string | null
          id?: string
          notes?: string | null
          order_date?: string | null
          payment_due_date?: string | null
          payment_terms?: number | null
          po_number?: string
          status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_items: {
        Row: {
          id: string
          item_id: string | null
          item_name: string | null
          quantity: number
          quotation_id: string
          unit_price: number
          variation_id: string | null
        }
        Insert: {
          id?: string
          item_id?: string | null
          item_name?: string | null
          quantity?: number
          quotation_id: string
          unit_price?: number
          variation_id?: string | null
        }
        Update: {
          id?: string
          item_id?: string | null
          item_name?: string | null
          quantity?: number
          quotation_id?: string
          unit_price?: number
          variation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotation_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_items_variation_id_fkey"
            columns: ["variation_id"]
            isOneToOne: false
            referencedRelation: "item_variations"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          created_at: string | null
          customer_id: string | null
          id: string
          notes: string | null
          payment_due_date: string | null
          payment_terms: number | null
          quotation_date: string | null
          quotation_number: string
          sales_agent: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          total_amount: number | null
          valid_until: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id?: string | null
          id?: string
          notes?: string | null
          payment_due_date?: string | null
          payment_terms?: number | null
          quotation_date?: string | null
          quotation_number: string
          sales_agent?: string | null
          status?: Database["public"]["Enums"]["quotation_status"]
          total_amount?: number | null
          valid_until?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string | null
          id?: string
          notes?: string | null
          payment_due_date?: string | null
          payment_terms?: number | null
          quotation_date?: string | null
          quotation_number?: string
          sales_agent?: string | null
          status?: Database["public"]["Enums"]["quotation_status"]
          total_amount?: number | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_agents: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      shipment_tracking: {
        Row: {
          actual_arrival: string | null
          created_at: string | null
          estimated_arrival: string | null
          id: string
          notes: string | null
          po_id: string | null
          ship_date: string | null
          shipping_method: string | null
          status: string
          tracking_number: string | null
          updated_at: string | null
        }
        Insert: {
          actual_arrival?: string | null
          created_at?: string | null
          estimated_arrival?: string | null
          id?: string
          notes?: string | null
          po_id?: string | null
          ship_date?: string | null
          shipping_method?: string | null
          status?: string
          tracking_number?: string | null
          updated_at?: string | null
        }
        Update: {
          actual_arrival?: string | null
          created_at?: string | null
          estimated_arrival?: string | null
          id?: string
          notes?: string | null
          po_id?: string | null
          ship_date?: string | null
          shipping_method?: string | null
          status?: string
          tracking_number?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_tracking_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "overseas_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      invoice_status: "draft" | "confirmed" | "paid" | "unpaid"
      movement_type:
        | "in_po"
        | "out_invoice"
        | "out_online_sale"
        | "transfer_w2s"
        | "transfer_s2w"
      online_sale_status: "completed" | "returned" | "cancelled"
      po_status: "draft" | "sent" | "partially_received" | "received"
      quotation_status: "draft" | "sent" | "accepted" | "rejected"
      sales_channel: "shopee" | "lazada" | "others"
      variation_type: "pack" | "cut"
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
      app_role: ["admin", "user"],
      invoice_status: ["draft", "confirmed", "paid", "unpaid"],
      movement_type: [
        "in_po",
        "out_invoice",
        "out_online_sale",
        "transfer_w2s",
        "transfer_s2w",
      ],
      online_sale_status: ["completed", "returned", "cancelled"],
      po_status: ["draft", "sent", "partially_received", "received"],
      quotation_status: ["draft", "sent", "accepted", "rejected"],
      sales_channel: ["shopee", "lazada", "others"],
      variation_type: ["pack", "cut"],
    },
  },
} as const
