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
      asset_snapshots: {
        Row: {
          accounts_payable_value: number
          captured_at: string
          created_at: string
          id: string
          incoming_assets_value: number
          incoming_stock_value: number
          inventory_value: number
          payable_assets_value: number
          receivables_value: number
          snapshot_date: string
          total_asset_value: number
        }
        Insert: {
          accounts_payable_value?: number
          captured_at?: string
          created_at?: string
          id?: string
          incoming_assets_value?: number
          incoming_stock_value?: number
          inventory_value?: number
          payable_assets_value?: number
          receivables_value?: number
          snapshot_date: string
          total_asset_value?: number
        }
        Update: {
          accounts_payable_value?: number
          captured_at?: string
          created_at?: string
          id?: string
          incoming_assets_value?: number
          incoming_stock_value?: number
          inventory_value?: number
          payable_assets_value?: number
          receivables_value?: number
          snapshot_date?: string
          total_asset_value?: number
        }
        Relationships: []
      }
      customer_follow_ups: {
        Row: {
          created_at: string
          customer_id: string
          followed_up_at: string
          id: string
          notes: string
          sales_agent: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          followed_up_at?: string
          id?: string
          notes?: string
          sales_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          followed_up_at?: string
          id?: string
          notes?: string
          sales_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      customer_price_history: {
        Row: {
          created_at: string
          created_by_email: string | null
          customer_id: string
          id: string
          item_id: string
          quantity: number
          reference_id: string | null
          reference_number: string | null
          sold_at: string
          source: string
          unit_price: number
          variation_id: string | null
        }
        Insert: {
          created_at?: string
          created_by_email?: string | null
          customer_id: string
          id?: string
          item_id: string
          quantity?: number
          reference_id?: string | null
          reference_number?: string | null
          sold_at?: string
          source: string
          unit_price?: number
          variation_id?: string | null
        }
        Update: {
          created_at?: string
          created_by_email?: string | null
          customer_id?: string
          id?: string
          item_id?: string
          quantity?: number
          reference_id?: string | null
          reference_number?: string | null
          sold_at?: string
          source?: string
          unit_price?: number
          variation_id?: string | null
        }
        Relationships: []
      }
      customer_prices: {
        Row: {
          created_at: string
          created_by_email: string | null
          customer_id: string
          fixed_price: number
          id: string
          item_id: string
          notes: string
          updated_at: string
          variation_id: string | null
        }
        Insert: {
          created_at?: string
          created_by_email?: string | null
          customer_id: string
          fixed_price?: number
          id?: string
          item_id: string
          notes?: string
          updated_at?: string
          variation_id?: string | null
        }
        Update: {
          created_at?: string
          created_by_email?: string | null
          customer_id?: string
          fixed_price?: number
          id?: string
          item_id?: string
          notes?: string
          updated_at?: string
          variation_id?: string | null
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          barangay_village: string | null
          city_municipality: string | null
          classification: string
          contact_person: string | null
          country: string | null
          created_at: string | null
          district_area: string | null
          email: string | null
          full_address: string | null
          id: string
          last_follow_up_at: string | null
          latitude: number | null
          longitude: number | null
          name: string
          phone: string | null
          postal_code: string | null
          province_state: string | null
          tags: string[]
        }
        Insert: {
          address?: string | null
          barangay_village?: string | null
          city_municipality?: string | null
          classification?: string
          contact_person?: string | null
          country?: string | null
          created_at?: string | null
          district_area?: string | null
          email?: string | null
          full_address?: string | null
          id?: string
          last_follow_up_at?: string | null
          latitude?: number | null
          longitude?: number | null
          name: string
          phone?: string | null
          postal_code?: string | null
          province_state?: string | null
          tags?: string[]
        }
        Update: {
          address?: string | null
          barangay_village?: string | null
          city_municipality?: string | null
          classification?: string
          contact_person?: string | null
          country?: string | null
          created_at?: string | null
          district_area?: string | null
          email?: string | null
          full_address?: string | null
          id?: string
          last_follow_up_at?: string | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          phone?: string | null
          postal_code?: string | null
          province_state?: string | null
          tags?: string[]
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
          balance_after: number | null
          balance_before: number | null
          created_at: string | null
          dest_balance_after: number | null
          dest_balance_before: number | null
          dest_location: string | null
          id: string
          item_id: string
          location: string | null
          notes: string | null
          open_after: number | null
          open_before: number | null
          quantity: number
          reference_id: string | null
          reference_type: string | null
          type: Database["public"]["Enums"]["movement_type"]
          unit: string | null
          user_email: string | null
          user_id: string | null
          variation_id: string | null
        }
        Insert: {
          balance_after?: number | null
          balance_before?: number | null
          created_at?: string | null
          dest_balance_after?: number | null
          dest_balance_before?: number | null
          dest_location?: string | null
          id?: string
          item_id: string
          location?: string | null
          notes?: string | null
          open_after?: number | null
          open_before?: number | null
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          type: Database["public"]["Enums"]["movement_type"]
          unit?: string | null
          user_email?: string | null
          user_id?: string | null
          variation_id?: string | null
        }
        Update: {
          balance_after?: number | null
          balance_before?: number | null
          created_at?: string | null
          dest_balance_after?: number | null
          dest_balance_before?: number | null
          dest_location?: string | null
          id?: string
          item_id?: string
          location?: string | null
          notes?: string | null
          open_after?: number | null
          open_before?: number | null
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          type?: Database["public"]["Enums"]["movement_type"]
          unit?: string | null
          user_email?: string | null
          user_id?: string | null
          variation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_variation_id_fkey"
            columns: ["variation_id"]
            isOneToOne: false
            referencedRelation: "item_variations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_financials: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          paid_at: string | null
          profit_margin: number
          total_cost: number
          total_profit: number
          total_sales: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id: string
          paid_at?: string | null
          profit_margin?: number
          total_cost?: number
          total_profit?: number
          total_sales?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          paid_at?: string | null
          profit_margin?: number
          total_cost?: number
          total_profit?: number
          total_sales?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_financials_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_item_cost_history: {
        Row: {
          changed_by: string | null
          changed_by_email: string | null
          created_at: string
          financial_id: string | null
          id: string
          invoice_id: string
          invoice_number: string | null
          item_id: string | null
          item_name: string | null
          new_cost: number
          previous_cost: number | null
          quantity: number | null
          reason: string | null
          variation_id: string | null
        }
        Insert: {
          changed_by?: string | null
          changed_by_email?: string | null
          created_at?: string
          financial_id?: string | null
          id?: string
          invoice_id: string
          invoice_number?: string | null
          item_id?: string | null
          item_name?: string | null
          new_cost: number
          previous_cost?: number | null
          quantity?: number | null
          reason?: string | null
          variation_id?: string | null
        }
        Update: {
          changed_by?: string | null
          changed_by_email?: string | null
          created_at?: string
          financial_id?: string | null
          id?: string
          invoice_id?: string
          invoice_number?: string | null
          item_id?: string | null
          item_name?: string | null
          new_cost?: number
          previous_cost?: number | null
          quantity?: number | null
          reason?: string | null
          variation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_item_cost_history_financial_id_fkey"
            columns: ["financial_id"]
            isOneToOne: false
            referencedRelation: "invoice_item_financials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_item_cost_history_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_item_financials: {
        Row: {
          cost_snapshot: number | null
          created_at: string
          id: string
          invoice_id: string
          item_id: string
          line_profit: number | null
          line_total_cost: number | null
          quantity: number
          unit_price: number
          updated_at: string
          variation_id: string | null
        }
        Insert: {
          cost_snapshot?: number | null
          created_at?: string
          id?: string
          invoice_id: string
          item_id: string
          line_profit?: number | null
          line_total_cost?: number | null
          quantity?: number
          unit_price?: number
          updated_at?: string
          variation_id?: string | null
        }
        Update: {
          cost_snapshot?: number | null
          created_at?: string
          id?: string
          invoice_id?: string
          item_id?: string
          line_profit?: number | null
          line_total_cost?: number | null
          quantity?: number
          unit_price?: number
          updated_at?: string
          variation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_item_financials_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
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
          cancelled_at: string | null
          created_at: string | null
          customer_id: string | null
          due_date: string | null
          id: string
          inventory_deducted: boolean
          invoice_date: string | null
          invoice_number: string
          notes: string | null
          payment_method: string | null
          payment_reference: string | null
          payment_reference_url: string | null
          quotation_id: string | null
          sales_agent: string | null
          shipped_at: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string | null
          customer_id?: string | null
          due_date?: string | null
          id?: string
          inventory_deducted?: boolean
          invoice_date?: string | null
          invoice_number: string
          notes?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_reference_url?: string | null
          quotation_id?: string | null
          sales_agent?: string | null
          shipped_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string | null
          customer_id?: string | null
          due_date?: string | null
          id?: string
          inventory_deducted?: boolean
          invoice_date?: string | null
          invoice_number?: string
          notes?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_reference_url?: string | null
          quotation_id?: string | null
          sales_agent?: string | null
          shipped_at?: string | null
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
      item_cost_history: {
        Row: {
          changed_by: string | null
          changed_by_email: string | null
          created_at: string
          currency: string | null
          difference: number
          exchange_rate: number | null
          id: string
          item_id: string
          new_cost: number
          percentage_change: number
          po_id: string | null
          po_number: string | null
          previous_cost: number
          reason: string
          source: string
          supplier_name: string | null
        }
        Insert: {
          changed_by?: string | null
          changed_by_email?: string | null
          created_at?: string
          currency?: string | null
          difference?: number
          exchange_rate?: number | null
          id?: string
          item_id: string
          new_cost?: number
          percentage_change?: number
          po_id?: string | null
          po_number?: string | null
          previous_cost?: number
          reason?: string
          source?: string
          supplier_name?: string | null
        }
        Update: {
          changed_by?: string | null
          changed_by_email?: string | null
          created_at?: string
          currency?: string | null
          difference?: number
          exchange_rate?: number | null
          id?: string
          item_id?: string
          new_cost?: number
          percentage_change?: number
          po_id?: string | null
          po_number?: string | null
          previous_cost?: number
          reason?: string
          source?: string
          supplier_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_cost_history_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_suppliers: {
        Row: {
          created_at: string
          created_by_email: string | null
          currency: string
          id: string
          is_primary: boolean
          item_id: string
          last_purchased_at: string | null
          latest_cost: number
          lead_time_days: number | null
          moq: number
          notes: string
          overseas_supplier_id: string | null
          supplier_id: string | null
          supplier_sku: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_email?: string | null
          currency?: string
          id?: string
          is_primary?: boolean
          item_id: string
          last_purchased_at?: string | null
          latest_cost?: number
          lead_time_days?: number | null
          moq?: number
          notes?: string
          overseas_supplier_id?: string | null
          supplier_id?: string | null
          supplier_sku?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_email?: string | null
          currency?: string
          id?: string
          is_primary?: boolean
          item_id?: string
          last_purchased_at?: string | null
          latest_cost?: number
          lead_time_days?: number | null
          moq?: number
          notes?: string
          overseas_supplier_id?: string | null
          supplier_id?: string | null
          supplier_sku?: string
          updated_at?: string
        }
        Relationships: []
      }
      item_variations: {
        Row: {
          cost_price: number | null
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
          cost_price?: number | null
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
          cost_price?: number | null
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
          archived_at: string | null
          archived_by_email: string | null
          barcode: string | null
          base_unit: string
          brand: string | null
          category: string | null
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
          status: string
          store_quantity: number
          supplier_sku: string | null
          units_per_stock: number
          updated_at: string | null
          warehouse_quantity: number
        }
        Insert: {
          archived_at?: string | null
          archived_by_email?: string | null
          barcode?: string | null
          base_unit?: string
          brand?: string | null
          category?: string | null
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
          status?: string
          store_quantity?: number
          supplier_sku?: string | null
          units_per_stock?: number
          updated_at?: string | null
          warehouse_quantity?: number
        }
        Update: {
          archived_at?: string | null
          archived_by_email?: string | null
          barcode?: string | null
          base_unit?: string
          brand?: string | null
          category?: string | null
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
          status?: string
          store_quantity?: number
          supplier_sku?: string | null
          units_per_stock?: number
          updated_at?: string | null
          warehouse_quantity?: number
        }
        Relationships: []
      }
      locations_barangay: {
        Row: {
          city_name: string
          country_code: string
          created_at: string
          id: string
          name: string
          region_name: string
        }
        Insert: {
          city_name: string
          country_code?: string
          created_at?: string
          id?: string
          name: string
          region_name: string
        }
        Update: {
          city_name?: string
          country_code?: string
          created_at?: string
          id?: string
          name?: string
          region_name?: string
        }
        Relationships: []
      }
      locations_city: {
        Row: {
          country_code: string
          created_at: string
          id: string
          name: string
          region_name: string
        }
        Insert: {
          country_code: string
          created_at?: string
          id?: string
          name: string
          region_name: string
        }
        Update: {
          country_code?: string
          created_at?: string
          id?: string
          name?: string
          region_name?: string
        }
        Relationships: []
      }
      locations_country: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      locations_region: {
        Row: {
          country_code: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          country_code: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          country_code?: string
          created_at?: string
          id?: string
          name?: string
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
      online_sale_financials: {
        Row: {
          amount_paid: number
          cost_snapshot: number | null
          created_at: string
          gross_margin: number | null
          has_cost: boolean
          id: string
          is_paid: boolean
          item_id: string | null
          line_profit: number | null
          line_total_cost: number | null
          online_sale_id: string
          paid_at: string | null
          quantity: number
          unit_price: number
          updated_at: string
          variation_id: string | null
        }
        Insert: {
          amount_paid?: number
          cost_snapshot?: number | null
          created_at?: string
          gross_margin?: number | null
          has_cost?: boolean
          id?: string
          is_paid?: boolean
          item_id?: string | null
          line_profit?: number | null
          line_total_cost?: number | null
          online_sale_id: string
          paid_at?: string | null
          quantity?: number
          unit_price?: number
          updated_at?: string
          variation_id?: string | null
        }
        Update: {
          amount_paid?: number
          cost_snapshot?: number | null
          created_at?: string
          gross_margin?: number | null
          has_cost?: boolean
          id?: string
          is_paid?: boolean
          item_id?: string | null
          line_profit?: number | null
          line_total_cost?: number | null
          online_sale_id?: string
          paid_at?: string | null
          quantity?: number
          unit_price?: number
          updated_at?: string
          variation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "online_sale_financials_online_sale_id_fkey"
            columns: ["online_sale_id"]
            isOneToOne: true
            referencedRelation: "online_sales"
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
          allocated_cargo_per_unit: number
          created_at: string | null
          description: string | null
          final_landed_cost: number | null
          id: string
          item_id: string | null
          item_name: string
          original_supplier_cost: number | null
          po_id: string
          quantity: number
          received_date: string | null
          received_quantity: number
          unit_cost: number
        }
        Insert: {
          allocated_cargo_per_unit?: number
          created_at?: string | null
          description?: string | null
          final_landed_cost?: number | null
          id?: string
          item_id?: string | null
          item_name: string
          original_supplier_cost?: number | null
          po_id: string
          quantity?: number
          received_date?: string | null
          received_quantity?: number
          unit_cost?: number
        }
        Update: {
          allocated_cargo_per_unit?: number
          created_at?: string | null
          description?: string | null
          final_landed_cost?: number | null
          id?: string
          item_id?: string | null
          item_name?: string
          original_supplier_cost?: number | null
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
          cargo_adjusted_at: string | null
          cargo_adjusted_by_email: string | null
          cargo_cost: number
          cargo_notes: string
          created_at: string | null
          currency: string
          customs_fee: number
          delivery_fee: number
          exchange_rate: number
          expected_delivery: string | null
          id: string
          misc_charges: number
          notes: string | null
          order_date: string | null
          po_number: string
          receipt_url: string | null
          shipping_fee: number
          status: string
          supplier_id: string | null
          total_additional_charges: number
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          cargo_adjusted_at?: string | null
          cargo_adjusted_by_email?: string | null
          cargo_cost?: number
          cargo_notes?: string
          created_at?: string | null
          currency?: string
          customs_fee?: number
          delivery_fee?: number
          exchange_rate?: number
          expected_delivery?: string | null
          id?: string
          misc_charges?: number
          notes?: string | null
          order_date?: string | null
          po_number: string
          receipt_url?: string | null
          shipping_fee?: number
          status?: string
          supplier_id?: string | null
          total_additional_charges?: number
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          cargo_adjusted_at?: string | null
          cargo_adjusted_by_email?: string | null
          cargo_cost?: number
          cargo_notes?: string
          created_at?: string | null
          currency?: string
          customs_fee?: number
          delivery_fee?: number
          exchange_rate?: number
          expected_delivery?: string | null
          id?: string
          misc_charges?: number
          notes?: string | null
          order_date?: string | null
          po_number?: string
          receipt_url?: string | null
          shipping_fee?: number
          status?: string
          supplier_id?: string | null
          total_additional_charges?: number
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
          allocated_cargo_per_unit: number
          final_landed_cost: number | null
          id: string
          item_id: string | null
          item_name: string | null
          original_supplier_cost: number | null
          po_id: string
          quantity: number
          received_date: string | null
          received_quantity: number
          unit_cost: number
        }
        Insert: {
          allocated_cargo_per_unit?: number
          final_landed_cost?: number | null
          id?: string
          item_id?: string | null
          item_name?: string | null
          original_supplier_cost?: number | null
          po_id: string
          quantity?: number
          received_date?: string | null
          received_quantity?: number
          unit_cost?: number
        }
        Update: {
          allocated_cargo_per_unit?: number
          final_landed_cost?: number | null
          id?: string
          item_id?: string | null
          item_name?: string | null
          original_supplier_cost?: number | null
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
          cargo_adjusted_at: string | null
          cargo_adjusted_by_email: string | null
          cargo_cost: number
          cargo_notes: string
          created_at: string | null
          customs_fee: number
          delivery_fee: number
          expected_delivery: string | null
          id: string
          misc_charges: number
          notes: string | null
          order_date: string | null
          payment_due_date: string | null
          payment_terms: number | null
          po_number: string
          shipping_fee: number
          status: Database["public"]["Enums"]["po_status"]
          supplier_id: string | null
          total_additional_charges: number
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          cargo_adjusted_at?: string | null
          cargo_adjusted_by_email?: string | null
          cargo_cost?: number
          cargo_notes?: string
          created_at?: string | null
          customs_fee?: number
          delivery_fee?: number
          expected_delivery?: string | null
          id?: string
          misc_charges?: number
          notes?: string | null
          order_date?: string | null
          payment_due_date?: string | null
          payment_terms?: number | null
          po_number: string
          shipping_fee?: number
          status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: string | null
          total_additional_charges?: number
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          cargo_adjusted_at?: string | null
          cargo_adjusted_by_email?: string | null
          cargo_cost?: number
          cargo_notes?: string
          created_at?: string | null
          customs_fee?: number
          delivery_fee?: number
          expected_delivery?: string | null
          id?: string
          misc_charges?: number
          notes?: string | null
          order_date?: string | null
          payment_due_date?: string | null
          payment_terms?: number | null
          po_number?: string
          shipping_fee?: number
          status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: string | null
          total_additional_charges?: number
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
      apply_overseas_po_cargo_adjustment: {
        Args: {
          _cargo_cost: number
          _customs_fee: number
          _delivery_fee: number
          _misc_charges: number
          _notes: string
          _po_id: string
          _shipping_fee: number
        }
        Returns: undefined
      }
      apply_po_cargo_adjustment: {
        Args: {
          _cargo_cost: number
          _customs_fee: number
          _delivery_fee: number
          _misc_charges: number
          _notes: string
          _po_id: string
          _shipping_fee: number
        }
        Returns: undefined
      }
      bulk_set_online_sale_cost: {
        Args: { _ids: string[]; _new_cost: number }
        Returns: number
      }
      generate_asset_snapshot: {
        Args: never
        Returns: {
          accounts_payable_value: number
          captured_at: string
          created_at: string
          id: string
          incoming_assets_value: number
          incoming_stock_value: number
          inventory_value: number
          payable_assets_value: number
          receivables_value: number
          snapshot_date: string
          total_asset_value: number
        }
        SetofOptions: {
          from: "*"
          to: "asset_snapshots"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_invoice_status_locked: { Args: { _status: string }; Returns: boolean }
      is_quotation_status_locked: {
        Args: { _status: string }
        Returns: boolean
      }
      record_item_cost_change: {
        Args: {
          _changed_by: string
          _changed_by_email: string
          _currency: string
          _exchange_rate: number
          _item_id: string
          _new_cost: number
          _po_id: string
          _po_number: string
          _reason: string
          _source: string
          _supplier_name: string
        }
        Returns: string
      }
      set_invoice_item_cost:
        | {
            Args: { _financial_id: string; _new_cost: number }
            Returns: undefined
          }
        | {
            Args: { _financial_id: string; _new_cost: number; _reason?: string }
            Returns: undefined
          }
      set_item_cost_manual: {
        Args: { _item_id: string; _new_cost: number; _reason: string }
        Returns: string
      }
      set_online_sale_cost: {
        Args: { _new_cost: number; _online_sale_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user"
      invoice_status:
        | "draft"
        | "confirmed"
        | "paid"
        | "unpaid"
        | "reserved"
        | "shipped"
        | "completed"
        | "cancelled"
      movement_type:
        | "in_po"
        | "out_invoice"
        | "out_online_sale"
        | "transfer_w2s"
        | "transfer_s2w"
        | "adjust_missing"
        | "adjust_surplus"
      online_sale_status: "completed" | "returned" | "cancelled"
      po_status:
        | "draft"
        | "sent"
        | "partially_received"
        | "received"
        | "pending_cargo_adjustment"
        | "cargo_adjusted"
        | "closed"
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
      invoice_status: [
        "draft",
        "confirmed",
        "paid",
        "unpaid",
        "reserved",
        "shipped",
        "completed",
        "cancelled",
      ],
      movement_type: [
        "in_po",
        "out_invoice",
        "out_online_sale",
        "transfer_w2s",
        "transfer_s2w",
        "adjust_missing",
        "adjust_surplus",
      ],
      online_sale_status: ["completed", "returned", "cancelled"],
      po_status: [
        "draft",
        "sent",
        "partially_received",
        "received",
        "pending_cargo_adjustment",
        "cargo_adjusted",
        "closed",
      ],
      quotation_status: ["draft", "sent", "accepted", "rejected"],
      sales_channel: ["shopee", "lazada", "others"],
      variation_type: ["pack", "cut"],
    },
  },
} as const
