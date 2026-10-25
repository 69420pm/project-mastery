export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      ai_usage: {
        Row: {
          cached_input_tokens: number;
          chat_id: string | null;
          cost_usd: number;
          created_at: string;
          estimated: boolean;
          id: string;
          input_tokens: number;
          model_id: string;
          output_tokens: number;
          owner: string;
          reply_id: string | null;
          task: string;
        };
        ComputedFields: never;
        Insert: {
          cached_input_tokens?: number;
          chat_id?: string | null;
          cost_usd: number;
          created_at?: string;
          estimated?: boolean;
          id?: string;
          input_tokens: number;
          model_id: string;
          output_tokens: number;
          owner?: string;
          reply_id?: string | null;
          task: string;
        };
        Update: {
          cached_input_tokens?: number;
          chat_id?: string | null;
          cost_usd?: number;
          created_at?: string;
          estimated?: boolean;
          id?: string;
          input_tokens?: number;
          model_id?: string;
          output_tokens?: number;
          owner?: string;
          reply_id?: string | null;
          task?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_usage_chat_id_fkey";
            columns: ["chat_id"];
            isOneToOne: false;
            referencedRelation: "chats";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_usage_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      attempts: {
        Row: {
          check: string | null;
          created_at: string;
          help: string;
          id: string;
          kc_id: string;
          kind: string;
          owner: string;
          question_id: string;
          result: string;
          session_id: string;
        };
        ComputedFields: never;
        Insert: {
          check?: string | null;
          created_at?: string;
          help: string;
          id?: string;
          kc_id: string;
          kind: string;
          owner?: string;
          question_id: string;
          result: string;
          session_id: string;
        };
        Update: {
          check?: string | null;
          created_at?: string;
          help?: string;
          id?: string;
          kc_id?: string;
          kind?: string;
          owner?: string;
          question_id?: string;
          result?: string;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attempts_kc_id_fkey";
            columns: ["kc_id"];
            isOneToOne: false;
            referencedRelation: "kcs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attempts_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attempts_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attempts_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "study_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      big_ideas: {
        Row: {
          course_id: string;
          created_at: string;
          description: string;
          id: string;
          name: string;
          owner: string;
          position: number;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          created_at?: string;
          description: string;
          id?: string;
          name: string;
          owner: string;
          position: number;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          description?: string;
          id?: string;
          name?: string;
          owner?: string;
          position?: number;
        };
        Relationships: [
          {
            foreignKeyName: "big_ideas_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "big_ideas_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      brief_excluded_materials: {
        Row: {
          course_id: string;
          material_id: string;
          owner: string;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          material_id: string;
          owner?: string;
        };
        Update: {
          course_id?: string;
          material_id?: string;
          owner?: string;
        };
        Relationships: [
          {
            foreignKeyName: "brief_excluded_materials_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "briefs";
            referencedColumns: ["course_id"];
          },
          {
            foreignKeyName: "brief_excluded_materials_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: false;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "brief_excluded_materials_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      brief_messages: {
        Row: {
          course_id: string;
          created_at: string;
          id: string;
          model_id: string | null;
          owner: string;
          parts: NonNullable<Json>;
          role: string;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          created_at?: string;
          id?: string;
          model_id?: string | null;
          owner?: string;
          parts: NonNullable<Json>;
          role: string;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          id?: string;
          model_id?: string | null;
          owner?: string;
          parts?: NonNullable<Json>;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: "brief_messages_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "briefs";
            referencedColumns: ["course_id"];
          },
          {
            foreignKeyName: "brief_messages_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      briefs: {
        Row: {
          calculator: boolean | null;
          course_id: string;
          created_at: string;
          exam_date: string | null;
          formula_sheet: boolean | null;
          goal: string | null;
          hours_per_week: number | null;
          notes: string | null;
          notes_updated_at: string | null;
          open_book: boolean | null;
          owner: string;
          question_style: string | null;
          scope_confirmed: boolean;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          calculator?: boolean | null;
          course_id: string;
          created_at?: string;
          exam_date?: string | null;
          formula_sheet?: boolean | null;
          goal?: string | null;
          hours_per_week?: number | null;
          notes?: string | null;
          notes_updated_at?: string | null;
          open_book?: boolean | null;
          owner?: string;
          question_style?: string | null;
          scope_confirmed?: boolean;
          updated_at?: string;
        };
        Update: {
          calculator?: boolean | null;
          course_id?: string;
          created_at?: string;
          exam_date?: string | null;
          formula_sheet?: boolean | null;
          goal?: string | null;
          hours_per_week?: number | null;
          notes?: string | null;
          notes_updated_at?: string | null;
          open_book?: boolean | null;
          owner?: string;
          question_style?: string | null;
          scope_confirmed?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "briefs_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: true;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "briefs_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_messages: {
        Row: {
          chat_id: string;
          created_at: string;
          id: string;
          model_id: string | null;
          parts: NonNullable<Json>;
          reading_section_id: string | null;
          role: string;
          stopped: boolean;
          tutor_context: Json | null;
        };
        ComputedFields: never;
        Insert: {
          chat_id: string;
          created_at?: string;
          id?: string;
          model_id?: string | null;
          parts: NonNullable<Json>;
          reading_section_id?: string | null;
          role: string;
          stopped?: boolean;
          tutor_context?: Json | null;
        };
        Update: {
          chat_id?: string;
          created_at?: string;
          id?: string;
          model_id?: string | null;
          parts?: NonNullable<Json>;
          reading_section_id?: string | null;
          role?: string;
          stopped?: boolean;
          tutor_context?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "chat_messages_chat_id_fkey";
            columns: ["chat_id"];
            isOneToOne: false;
            referencedRelation: "chats";
            referencedColumns: ["id"];
          },
        ];
      };
      chats: {
        Row: {
          course_id: string;
          created_at: string;
          id: string;
          last_message_at: string;
          latest_reply_id: string | null;
          owner: string;
          title: string | null;
          title_set_manually: boolean;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          created_at?: string;
          id?: string;
          last_message_at?: string;
          latest_reply_id?: string | null;
          owner?: string;
          title?: string | null;
          title_set_manually?: boolean;
          updated_at?: string;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          id?: string;
          last_message_at?: string;
          latest_reply_id?: string | null;
          owner?: string;
          title?: string | null;
          title_set_manually?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chats_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chats_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      chunks: {
        Row: {
          course_id: string;
          created_at: string;
          embedding: string | null;
          exercise_number: string | null;
          figure: Json | null;
          id: string;
          label: string;
          markdown: string;
          material_id: string;
          owner: string;
          page_from: number;
          page_to: number;
          points: number | null;
          position: number;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          created_at?: string;
          embedding?: string | null;
          exercise_number?: string | null;
          figure?: Json | null;
          id?: string;
          label: string;
          markdown: string;
          material_id: string;
          owner: string;
          page_from: number;
          page_to: number;
          points?: number | null;
          position: number;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          embedding?: string | null;
          exercise_number?: string | null;
          figure?: Json | null;
          id?: string;
          label?: string;
          markdown?: string;
          material_id?: string;
          owner?: string;
          page_from?: number;
          page_to?: number;
          points?: number | null;
          position?: number;
        };
        Relationships: [
          {
            foreignKeyName: "chunks_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chunks_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: false;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chunks_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      courses: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          owner: string;
          pairing_requested: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          owner?: string;
          pairing_requested?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          owner?: string;
          pairing_requested?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "courses_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      exercise_kcs: {
        Row: {
          course_id: string;
          exercise_id: string;
          kc_id: string;
          owner: string;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          exercise_id: string;
          kc_id: string;
          owner: string;
        };
        Update: {
          course_id?: string;
          exercise_id?: string;
          kc_id?: string;
          owner?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exercise_kcs_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exercise_kcs_exercise_id_fkey";
            columns: ["exercise_id"];
            isOneToOne: false;
            referencedRelation: "exercises";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exercise_kcs_kc_id_fkey";
            columns: ["kc_id"];
            isOneToOne: false;
            referencedRelation: "kcs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exercise_kcs_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      exercise_solutions: {
        Row: {
          course_id: string;
          created_at: string;
          exercise_chunk_id: string;
          id: string;
          owner: string;
          solution_chunk_id: string | null;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          created_at?: string;
          exercise_chunk_id: string;
          id?: string;
          owner: string;
          solution_chunk_id?: string | null;
          status: string;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          exercise_chunk_id?: string;
          id?: string;
          owner?: string;
          solution_chunk_id?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exercise_solutions_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exercise_solutions_exercise_chunk_id_fkey";
            columns: ["exercise_chunk_id"];
            isOneToOne: true;
            referencedRelation: "chunks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exercise_solutions_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exercise_solutions_solution_chunk_id_fkey";
            columns: ["solution_chunk_id"];
            isOneToOne: false;
            referencedRelation: "chunks";
            referencedColumns: ["id"];
          },
        ];
      };
      exercises: {
        Row: {
          course_id: string;
          created_at: string;
          difficulty: number;
          final_answers: Json | null;
          id: string;
          name: string;
          owner: string;
          position: number;
          question_chunk_id: string;
          solution: string | null;
          solution_status: string;
          task_type: string;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          created_at?: string;
          difficulty: number;
          final_answers?: Json | null;
          id?: string;
          name: string;
          owner: string;
          position: number;
          question_chunk_id: string;
          solution?: string | null;
          solution_status: string;
          task_type: string;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          difficulty?: number;
          final_answers?: Json | null;
          id?: string;
          name?: string;
          owner?: string;
          position?: number;
          question_chunk_id?: string;
          solution?: string | null;
          solution_status?: string;
          task_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exercises_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exercises_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exercises_question_chunk_id_fkey";
            columns: ["question_chunk_id"];
            isOneToOne: false;
            referencedRelation: "chunks";
            referencedColumns: ["id"];
          },
        ];
      };
      finding_sources: {
        Row: {
          chunk_id: string;
          course_id: string;
          finding_id: string;
          owner: string;
        };
        ComputedFields: never;
        Insert: {
          chunk_id: string;
          course_id: string;
          finding_id: string;
          owner: string;
        };
        Update: {
          chunk_id?: string;
          course_id?: string;
          finding_id?: string;
          owner?: string;
        };
        Relationships: [
          {
            foreignKeyName: "finding_sources_chunk_id_fkey";
            columns: ["chunk_id"];
            isOneToOne: false;
            referencedRelation: "chunks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finding_sources_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finding_sources_finding_id_fkey";
            columns: ["finding_id"];
            isOneToOne: false;
            referencedRelation: "findings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finding_sources_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      findings: {
        Row: {
          answer: string | null;
          answered_at: string | null;
          asked_at: string | null;
          course_id: string;
          created_at: string;
          id: string;
          kind: string;
          owner: string;
          position: number;
          status: string;
          text: string;
        };
        ComputedFields: never;
        Insert: {
          answer?: string | null;
          answered_at?: string | null;
          asked_at?: string | null;
          course_id: string;
          created_at?: string;
          id?: string;
          kind: string;
          owner: string;
          position: number;
          status?: string;
          text: string;
        };
        Update: {
          answer?: string | null;
          answered_at?: string | null;
          asked_at?: string | null;
          course_id?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          owner?: string;
          position?: number;
          status?: string;
          text?: string;
        };
        Relationships: [
          {
            foreignKeyName: "findings_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "findings_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      kc_priorities: {
        Row: {
          course_id: string;
          kc_id: string;
          multiplier: number;
          owner: string;
          priority: number;
          reasons: string[];
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          kc_id: string;
          multiplier: number;
          owner: string;
          priority: number;
          reasons?: string[];
        };
        Update: {
          course_id?: string;
          kc_id?: string;
          multiplier?: number;
          owner?: string;
          priority?: number;
          reasons?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "kc_priorities_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "kc_priorities_kc_id_fkey";
            columns: ["kc_id"];
            isOneToOne: true;
            referencedRelation: "kcs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "kc_priorities_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      kc_sources: {
        Row: {
          chunk_id: string;
          course_id: string;
          kc_id: string;
          owner: string;
        };
        ComputedFields: never;
        Insert: {
          chunk_id: string;
          course_id: string;
          kc_id: string;
          owner: string;
        };
        Update: {
          chunk_id?: string;
          course_id?: string;
          kc_id?: string;
          owner?: string;
        };
        Relationships: [
          {
            foreignKeyName: "kc_sources_chunk_id_fkey";
            columns: ["chunk_id"];
            isOneToOne: false;
            referencedRelation: "chunks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "kc_sources_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "kc_sources_kc_id_fkey";
            columns: ["kc_id"];
            isOneToOne: false;
            referencedRelation: "kcs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "kc_sources_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      kcs: {
        Row: {
          big_idea_id: string | null;
          bloom: string | null;
          course_id: string;
          created_at: string;
          description: string;
          id: string;
          name: string;
          origin: string;
          owner: string;
          position: number;
          type: string;
        };
        ComputedFields: never;
        Insert: {
          big_idea_id?: string | null;
          bloom?: string | null;
          course_id: string;
          created_at?: string;
          description: string;
          id?: string;
          name: string;
          origin: string;
          owner: string;
          position: number;
          type: string;
        };
        Update: {
          big_idea_id?: string | null;
          bloom?: string | null;
          course_id?: string;
          created_at?: string;
          description?: string;
          id?: string;
          name?: string;
          origin?: string;
          owner?: string;
          position?: number;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "kcs_big_idea_id_fkey";
            columns: ["big_idea_id"];
            isOneToOne: false;
            referencedRelation: "big_ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "kcs_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "kcs_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      knowledge_map_builds: {
        Row: {
          check_report: Json | null;
          course_id: string;
          failure_reason: string | null;
          finished_at: string | null;
          owner: string;
          started_at: string;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          check_report?: Json | null;
          course_id: string;
          failure_reason?: string | null;
          finished_at?: string | null;
          owner: string;
          started_at?: string;
          status: string;
        };
        Update: {
          check_report?: Json | null;
          course_id?: string;
          failure_reason?: string | null;
          finished_at?: string | null;
          owner?: string;
          started_at?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "knowledge_map_builds_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: true;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_map_builds_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      knowledge_map_chunks: {
        Row: {
          chunk_id: string;
          course_id: string;
          owner: string;
        };
        ComputedFields: never;
        Insert: {
          chunk_id: string;
          course_id: string;
          owner: string;
        };
        Update: {
          chunk_id?: string;
          course_id?: string;
          owner?: string;
        };
        Relationships: [
          {
            foreignKeyName: "knowledge_map_chunks_chunk_id_fkey";
            columns: ["chunk_id"];
            isOneToOne: true;
            referencedRelation: "chunks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_map_chunks_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_map_chunks_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      material_pages: {
        Row: {
          created_at: string;
          id: string;
          material_id: string;
          owner: string;
          page_number: number;
          units: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          material_id: string;
          owner: string;
          page_number: number;
          units: NonNullable<Json>;
        };
        Update: {
          created_at?: string;
          id?: string;
          material_id?: string;
          owner?: string;
          page_number?: number;
          units?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: "material_pages_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: false;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "material_pages_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      materials: {
        Row: {
          course_id: string;
          created_at: string;
          exam_total_points: number | null;
          exam_year: number | null;
          id: string;
          is_exam: boolean | null;
          media_type: string;
          name: string;
          owner: string;
          pages_done: number;
          pages_total: number | null;
          parse_failure: string | null;
          parse_start_failed: boolean;
          parse_status: string;
          size_bytes: number;
          storage_path: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          created_at?: string;
          exam_total_points?: number | null;
          exam_year?: number | null;
          id?: string;
          is_exam?: boolean | null;
          media_type: string;
          name: string;
          owner?: string;
          pages_done?: number;
          pages_total?: number | null;
          parse_failure?: string | null;
          parse_start_failed?: boolean;
          parse_status?: string;
          size_bytes: number;
          storage_path: string;
          updated_at?: string;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          exam_total_points?: number | null;
          exam_year?: number | null;
          id?: string;
          is_exam?: boolean | null;
          media_type?: string;
          name?: string;
          owner?: string;
          pages_done?: number;
          pages_total?: number | null;
          parse_failure?: string | null;
          parse_start_failed?: boolean;
          parse_status?: string;
          size_bytes?: number;
          storage_path?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "materials_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "materials_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      memories: {
        Row: {
          course_id: string;
          owner: string;
          text: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          owner?: string;
          text?: string;
          updated_at?: string;
        };
        Update: {
          course_id?: string;
          owner?: string;
          text?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memories_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: true;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memories_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      prerequisite_links: {
        Row: {
          course_id: string;
          extraction_confidence: number;
          from_kc: string;
          id: string;
          owner: string;
          to_kc: string;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          extraction_confidence: number;
          from_kc: string;
          id?: string;
          owner: string;
          to_kc: string;
        };
        Update: {
          course_id?: string;
          extraction_confidence?: number;
          from_kc?: string;
          id?: string;
          owner?: string;
          to_kc?: string;
        };
        Relationships: [
          {
            foreignKeyName: "prerequisite_links_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prerequisite_links_from_kc_fkey";
            columns: ["from_kc"];
            isOneToOne: false;
            referencedRelation: "kcs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prerequisite_links_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prerequisite_links_to_kc_fkey";
            columns: ["to_kc"];
            isOneToOne: false;
            referencedRelation: "kcs";
            referencedColumns: ["id"];
          },
        ];
      };
      priority_runs: {
        Row: {
          adjusted_at: string | null;
          adjustments: NonNullable<Json>;
          computed_at: string;
          course_id: string;
          failure_reason: string | null;
          owner: string;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          adjusted_at?: string | null;
          adjustments?: NonNullable<Json>;
          computed_at?: string;
          course_id: string;
          failure_reason?: string | null;
          owner: string;
          status: string;
        };
        Update: {
          adjusted_at?: string | null;
          adjustments?: NonNullable<Json>;
          computed_at?: string;
          course_id?: string;
          failure_reason?: string | null;
          owner?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "priority_runs_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: true;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "priority_runs_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          display_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      question_kcs: {
        Row: {
          kc_id: string;
          question_id: string;
        };
        ComputedFields: never;
        Insert: {
          kc_id: string;
          question_id: string;
        };
        Update: {
          kc_id?: string;
          question_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "question_kcs_kc_id_fkey";
            columns: ["kc_id"];
            isOneToOne: false;
            referencedRelation: "kcs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "question_kcs_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
        ];
      };
      questions: {
        Row: {
          answer_message_id: string | null;
          answer_text: string | null;
          answered_at: string | null;
          asked_at: string;
          confidence: number | null;
          exercise_id: string | null;
          graded_at: string | null;
          id: string;
          kind: string;
          owner: string;
          prompt: string;
          session_id: string;
        };
        ComputedFields: never;
        Insert: {
          answer_message_id?: string | null;
          answer_text?: string | null;
          answered_at?: string | null;
          asked_at?: string;
          confidence?: number | null;
          exercise_id?: string | null;
          graded_at?: string | null;
          id?: string;
          kind: string;
          owner?: string;
          prompt: string;
          session_id: string;
        };
        Update: {
          answer_message_id?: string | null;
          answer_text?: string | null;
          answered_at?: string | null;
          asked_at?: string;
          confidence?: number | null;
          exercise_id?: string | null;
          graded_at?: string | null;
          id?: string;
          kind?: string;
          owner?: string;
          prompt?: string;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "questions_answer_message_id_fkey";
            columns: ["answer_message_id"];
            isOneToOne: false;
            referencedRelation: "chat_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questions_exercise_id_fkey";
            columns: ["exercise_id"];
            isOneToOne: false;
            referencedRelation: "exercises";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questions_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questions_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "study_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      reading_sections: {
        Row: {
          annotations: Json | null;
          chunk_ids: string[];
          course_id: string;
          generated_at: string;
          id: string;
          material_id: string;
          mode: string;
          owner: string;
          page_from: number;
          page_to: number;
          position: number;
          reason: string;
          study_text: string | null;
          topic_id: string;
        };
        ComputedFields: never;
        Insert: {
          annotations?: Json | null;
          chunk_ids: string[];
          course_id: string;
          generated_at?: string;
          id?: string;
          material_id: string;
          mode: string;
          owner: string;
          page_from: number;
          page_to: number;
          position: number;
          reason: string;
          study_text?: string | null;
          topic_id: string;
        };
        Update: {
          annotations?: Json | null;
          chunk_ids?: string[];
          course_id?: string;
          generated_at?: string;
          id?: string;
          material_id?: string;
          mode?: string;
          owner?: string;
          page_from?: number;
          page_to?: number;
          position?: number;
          reason?: string;
          study_text?: string | null;
          topic_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reading_sections_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reading_sections_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: false;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reading_sections_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reading_sections_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      semantic_links: {
        Row: {
          core_type: string;
          course_id: string;
          from_kc: string;
          id: string;
          label: string;
          owner: string;
          to_kc: string;
        };
        ComputedFields: never;
        Insert: {
          core_type: string;
          course_id: string;
          from_kc: string;
          id?: string;
          label: string;
          owner: string;
          to_kc: string;
        };
        Update: {
          core_type?: string;
          course_id?: string;
          from_kc?: string;
          id?: string;
          label?: string;
          owner?: string;
          to_kc?: string;
        };
        Relationships: [
          {
            foreignKeyName: "semantic_links_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "semantic_links_from_kc_fkey";
            columns: ["from_kc"];
            isOneToOne: false;
            referencedRelation: "kcs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "semantic_links_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "semantic_links_to_kc_fkey";
            columns: ["to_kc"];
            isOneToOne: false;
            referencedRelation: "kcs";
            referencedColumns: ["id"];
          },
        ];
      };
      study_sessions: {
        Row: {
          chat_id: string | null;
          course_id: string;
          ended_at: string | null;
          id: string;
          mode: string;
          owner: string;
          stage: string | null;
          started_at: string;
          topic_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          chat_id?: string | null;
          course_id: string;
          ended_at?: string | null;
          id?: string;
          mode: string;
          owner: string;
          stage?: string | null;
          started_at?: string;
          topic_id?: string | null;
        };
        Update: {
          chat_id?: string | null;
          course_id?: string;
          ended_at?: string | null;
          id?: string;
          mode?: string;
          owner?: string;
          stage?: string | null;
          started_at?: string;
          topic_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "study_sessions_chat_id_fkey";
            columns: ["chat_id"];
            isOneToOne: true;
            referencedRelation: "chats";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "study_sessions_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "study_sessions_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      topic_choices: {
        Row: {
          choice: string;
          created_at: string;
          owner: string;
          topic_id: string;
        };
        ComputedFields: never;
        Insert: {
          choice: string;
          created_at?: string;
          owner?: string;
          topic_id: string;
        };
        Update: {
          choice?: string;
          created_at?: string;
          owner?: string;
          topic_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "topic_choices_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "topic_choices_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      topic_kcs: {
        Row: {
          kc_id: string;
          owner: string;
          position: number;
          topic_id: string;
        };
        ComputedFields: never;
        Insert: {
          kc_id: string;
          owner: string;
          position: number;
          topic_id: string;
        };
        Update: {
          kc_id?: string;
          owner?: string;
          position?: number;
          topic_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "topic_kcs_kc_id_fkey";
            columns: ["kc_id"];
            isOneToOne: true;
            referencedRelation: "kcs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "topic_kcs_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "topic_kcs_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      topics: {
        Row: {
          big_idea_id: string;
          central_question: string;
          course_id: string;
          created_at: string;
          id: string;
          name: string;
          owner: string;
          position: number;
          why_it_matters: string;
        };
        ComputedFields: never;
        Insert: {
          big_idea_id: string;
          central_question: string;
          course_id: string;
          created_at?: string;
          id?: string;
          name: string;
          owner: string;
          position: number;
          why_it_matters: string;
        };
        Update: {
          big_idea_id?: string;
          central_question?: string;
          course_id?: string;
          created_at?: string;
          id?: string;
          name?: string;
          owner?: string;
          position?: number;
          why_it_matters?: string;
        };
        Relationships: [
          {
            foreignKeyName: "topics_big_idea_id_fkey";
            columns: ["big_idea_id"];
            isOneToOne: false;
            referencedRelation: "big_ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "topics_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "topics_owner_fkey";
            columns: ["owner"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_brief_note: {
        Args: { course_id: string; text: string };
        Returns: boolean;
      };
      append_memory: {
        Args: { course_id: string; text: string };
        Returns: boolean;
      };
      apply_knowledge_map_update: {
        Args: {
          p_check_report: Json;
          p_chunk_ids: string[];
          p_course_id: string;
          p_map: Json;
        };
        Returns: boolean;
      };
      queue_knowledge_map_build: {
        Args: { course_id: string };
        Returns: boolean;
      };
      queue_material_parse: { Args: { material_id: string }; Returns: boolean };
      queue_priority_run: { Args: { course_id: string }; Returns: boolean };
      record_knowledge_map_build_start_failure: {
        Args: { course_id: string };
        Returns: boolean;
      };
      record_parse_start_failure: {
        Args: { material_id: string };
        Returns: boolean;
      };
      record_priority_run_start_failure: {
        Args: { course_id: string };
        Returns: boolean;
      };
      replace_exercise_solutions: {
        Args: { p_course_id: string; p_pairs: Json; p_request: number };
        Returns: boolean;
      };
      replace_kc_priorities: {
        Args: { p_adjustments?: Json; p_course_id: string; p_priorities: Json };
        Returns: boolean;
      };
      replace_material_chunks: {
        Args: {
          p_chunks: Json;
          p_exam_total_points?: number;
          p_exam_year?: number;
          p_is_exam: boolean;
          p_material_id: string;
        };
        Returns: undefined;
      };
      replace_reading_sections: {
        Args: { p_course_id: string; p_mark_built?: boolean; p_sections: Json };
        Returns: boolean;
      };
      replace_topics: {
        Args: { p_course_id: string; p_topics: Json };
        Returns: boolean;
      };
      request_exercise_pairing: {
        Args: { p_course_id: string };
        Returns: number;
      };
      save_brief: {
        Args: {
          course_id: string;
          excluded_material_ids?: string[];
          fields?: Json;
        };
        Returns: boolean;
      };
      set_chunk_embeddings: {
        Args: { p_embeddings: Json };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
