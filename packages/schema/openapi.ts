/* eslint-disable */
/**
 * GENERATED FILE. Do not edit by hand.
 * Source: packages/schema/openapi.json (`cd services && uv run python -m api.export_openapi`).
 * Regenerate with `pnpm --filter @vv/schema generate`.
 */

export interface paths {
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health */
        get: operations["health_api_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Jobs */
        get: operations["list_jobs_api_jobs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/jobs/{job_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Job */
        get: operations["get_job_api_jobs__job_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/jobs/{job_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel */
        post: operations["cancel_api_jobs__job_id__cancel_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/looks/{look_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Look */
        get: operations["get_look_api_looks__look_id__get"];
        put?: never;
        post?: never;
        /** Delete Look */
        delete: operations["delete_look_api_looks__look_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/looks/{look_id}/export.pdf": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Export Look */
        get: operations["export_look_api_looks__look_id__export_pdf_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/looks/{look_id}/render": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Render Look */
        post: operations["render_look_api_looks__look_id__render_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/photos/{photo_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Photo */
        delete: operations["delete_photo_api_photos__photo_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/photos/{photo_id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve Photo */
        post: operations["approve_photo_api_photos__photo_id__approve_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/renders/{render_id}/regenerate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Regenerate */
        post: operations["regenerate_api_renders__render_id__regenerate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Settings */
        get: operations["get_settings_api_settings_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Patch Settings */
        patch: operations["patch_settings_api_settings_patch"];
        trace?: never;
    };
    "/api/spaces/{space_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Space */
        get: operations["get_space_api_spaces__space_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Patch Space */
        patch: operations["patch_space_api_spaces__space_id__patch"];
        trace?: never;
    };
    "/api/spaces/{space_id}/chat": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Chat History */
        get: operations["chat_history_api_spaces__space_id__chat_get"];
        put?: never;
        /** Chat */
        post: operations["chat_api_spaces__space_id__chat_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/spaces/{space_id}/generate-base": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate Base */
        post: operations["generate_base_api_spaces__space_id__generate_base_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/spaces/{space_id}/looks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Looks */
        get: operations["list_looks_api_spaces__space_id__looks_get"];
        put?: never;
        /** Create Look */
        post: operations["create_look_api_spaces__space_id__looks_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/spaces/{space_id}/photos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Upload Photos */
        post: operations["upload_photos_api_spaces__space_id__photos_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/spaces/{space_id}/references/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Import Reference */
        post: operations["import_reference_api_spaces__space_id__references_import_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/spec/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Check Spec */
        post: operations["check_spec_api_spec_check_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/spec/default": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Default Spec */
        get: operations["get_default_spec_api_spec_default_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/system/backends": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Backends */
        get: operations["backends_api_system_backends_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/system/backends/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Refresh Backends */
        post: operations["refresh_backends_api_system_backends_refresh_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/system/backends/{kind}/{id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Test Backend */
        post: operations["test_backend_api_system_backends__kind___id__test_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/system/lan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Lan Info
         * @description Show the current pairing code without extending it, issuing one if none is active.
         */
        get: operations["lan_info_api_system_lan_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/system/lan/code": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * New Code
         * @description Replace the pairing code with a fresh one (owner only). During a lockout it returns `pairing_locked_for`.
         */
        post: operations["new_code_api_system_lan_code_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/system/lan/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Devices */
        get: operations["list_devices_api_system_lan_devices_get"];
        put?: never;
        post?: never;
        /** Forget All Devices */
        delete: operations["forget_all_devices_api_system_lan_devices_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/system/lan/devices/{device_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Forget Device */
        delete: operations["forget_device_api_system_lan_devices__device_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/system/lan/pair": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Pair */
        post: operations["pair_api_system_lan_pair_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/system/setup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Setup */
        get: operations["setup_api_system_setup_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/venues": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Venues */
        get: operations["list_venues_api_venues_get"];
        put?: never;
        /** Create Venue */
        post: operations["create_venue_api_venues_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/venues/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Import Venue */
        post: operations["import_venue_api_venues_import_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/venues/research": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Research Venue */
        post: operations["research_venue_api_venues_research_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/venues/{venue_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Venue */
        get: operations["get_venue_api_venues__venue_id__get"];
        put?: never;
        post?: never;
        /** Delete Venue */
        delete: operations["delete_venue_api_venues__venue_id__delete"];
        options?: never;
        head?: never;
        /** Patch Venue */
        patch: operations["patch_venue_api_venues__venue_id__patch"];
        trace?: never;
    };
    "/api/venues/{venue_id}/spaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create Space */
        post: operations["create_space_api_venues__venue_id__spaces_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/venues/{venue_id}/video": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Upload Video */
        post: operations["upload_video_api_venues__venue_id__video_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/venues/{venue_id}/video/apply": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Apply Video */
        post: operations["apply_video_api_venues__venue_id__video_apply_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/files/tests/{sample_id}.png": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Test Sample */
        get: operations["get_test_sample_files_tests__sample_id__png_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/files/{path}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get File */
        get: operations["get_file_files__path__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** Ambiguity */
        Ambiguity: {
            /** Options */
            options: string[];
            /** Question */
            question: string;
        };
        /** BackendCaps */
        BackendCaps: {
            /** Can Edit */
            can_edit: boolean;
            /** Can Generate */
            can_generate: boolean;
            /** Cost Note */
            cost_note: string;
            /**
             * Max Refs
             * @default 0
             */
            max_refs: number;
            /** Photoreal */
            photoreal: boolean;
            /** Typical Seconds */
            typical_seconds: number;
        };
        /** BackendDefaults */
        BackendDefaults: {
            /** Brain */
            brain: string | null;
            /** Engine */
            engine: string | null;
        };
        /** BackendInstall */
        BackendInstall: {
            /** Docs Url */
            docs_url: string;
            /** Linux */
            linux: string;
            /** Macos */
            macos: string;
        };
        /** BackendLogin */
        BackendLogin: {
            /** Command */
            command: string;
            /** Note */
            note: string | null;
        };
        /** BackendStatus */
        BackendStatus: {
            /** Available */
            available: boolean;
            caps?: components["schemas"]["BackendCaps"] | null;
            /** Cost Note */
            cost_note: string;
            /** Detail */
            detail: string | null;
            /** Id */
            id: string;
            /** Image Setup */
            image_setup?: string | null;
            install: components["schemas"]["BackendInstall"];
            /**
             * Kind
             * @enum {string}
             */
            kind: "brain" | "engine";
            /** Label */
            label: string;
            last_test: components["schemas"]["LastTest"] | null;
            /** Logged In */
            logged_in: boolean | null;
            login: components["schemas"]["BackendLogin"] | null;
            /** Used For */
            used_for: ("chat" | "web_research" | "vision" | "images")[];
            /** Version */
            version: string | null;
        };
        /** BackendTestIn */
        BackendTestIn: {
            /**
             * Confirm Credits
             * @default false
             */
            confirm_credits: boolean;
        };
        /** BackendTestOut */
        BackendTestOut: {
            /** Detail */
            detail: string;
            /** Ok */
            ok: boolean;
            /** Sample Url */
            sample_url?: string | null;
            /** Seconds */
            seconds: number;
        };
        /** BackendThresholds */
        BackendThresholds: {
            /** Structure Ok */
            structure_ok: number;
        };
        /** BackendsOut */
        BackendsOut: {
            /** Brains */
            brains: components["schemas"]["BackendStatus"][];
            defaults: components["schemas"]["BackendDefaults"];
            /** Engines */
            engines: components["schemas"]["BackendStatus"][];
            /**
             * Internal
             * @default {}
             */
            internal: {
                [key: string]: components["schemas"]["BackendStatus"];
            };
            thresholds: components["schemas"]["BackendThresholds"];
        };
        /** BaseResult */
        BaseResult: {
            /** Photo Id */
            photo_id: string;
        };
        /** Body_upload_photos_api_spaces__space_id__photos_post */
        Body_upload_photos_api_spaces__space_id__photos_post: {
            /** Files */
            files?: string[] | null;
            /** Files[] */
            "files[]"?: string[] | null;
        };
        /** Body_upload_video_api_venues__venue_id__video_post */
        Body_upload_video_api_venues__venue_id__video_post: {
            /** Brain */
            brain?: string | null;
            /** File */
            file: string;
        };
        /** Centerpieces */
        Centerpieces: {
            /**
             * Candles
             * @default none
             * @enum {string}
             */
            candles: "none" | "flameless" | "live";
            /** Colors */
            colors?: string[] | null;
            /** Container */
            container?: string | null;
            /** Flowers */
            flowers?: string[] | null;
            /** Greenery */
            greenery?: string | null;
            /**
             * Height
             * @enum {string}
             */
            height: "none" | "low" | "medium" | "tall" | "mixed";
        };
        /** Chairs */
        Chairs: {
            /** Color */
            color: string;
            /** Cushion */
            cushion?: string | null;
            /** Sash */
            sash?: string | null;
            /** Style */
            style: string;
        };
        /** ChatIn */
        ChatIn: {
            /** Brain */
            brain?: string | null;
            /** Message */
            message: string;
            spec?: components["schemas"]["DesignSpec"] | null;
        };
        /** ChatMessageOut */
        ChatMessageOut: {
            /** Ambiguities */
            ambiguities?: components["schemas"]["Ambiguity"][];
            /** Content */
            content: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Id */
            id: string;
            /** Intent */
            intent?: ("edit" | "render" | "question" | "none") | null;
            /** Look Name */
            look_name?: string | null;
            /**
             * Role
             * @enum {string}
             */
            role: "user" | "assistant";
        };
        /** ChatOut */
        ChatOut: {
            /** Ambiguities */
            ambiguities: components["schemas"]["Ambiguity"][];
            /** Brain */
            brain: string;
            /**
             * Intent
             * @enum {string}
             */
            intent: "edit" | "render" | "question" | "none";
            /** Look Name */
            look_name: string | null;
            /** Reply */
            reply: string;
            /** Rule Notes */
            rule_notes: string[];
            spec: components["schemas"]["DesignSpec"];
            /** Spec Changed */
            spec_changed: boolean;
            /** Warnings */
            warnings: components["schemas"]["RuleWarning"][];
        };
        /** ClaudeOptions */
        ClaudeOptions: {
            /** Config Dir */
            config_dir?: string | null;
        };
        /** ClaudePatch */
        ClaudePatch: {
            /** Config Dir */
            config_dir?: string | null;
        };
        /** CopilotOptions */
        CopilotOptions: {
            /** Model */
            model?: string | null;
        };
        /** DesignSpec */
        DesignSpec: {
            centerpieces: components["schemas"]["Centerpieces"];
            chairs: components["schemas"]["Chairs"];
            effects?: components["schemas"]["Effects"];
            /**
             * Event Type
             * @default wedding
             * @enum {string}
             */
            event_type: "wedding" | "corporate" | "birthday" | "gala" | "shower" | "other";
            /** Extras */
            extras: string[];
            /** Guest Count */
            guest_count?: number | null;
            install?: components["schemas"]["Install"];
            lighting: components["schemas"]["Lighting"];
            linens: components["schemas"]["Linens"];
            napkins?: components["schemas"]["Napkins"] | null;
            /** Notes */
            notes?: string | null;
            /** Palette */
            palette: string[];
            scene?: components["schemas"]["Scene"] | null;
            /** Space */
            space: string;
            tables: components["schemas"]["Tables"];
            /**
             * Version
             * @default 1
             * @constant
             */
            version: 1;
        };
        /** Effects */
        Effects: {
            /**
             * Confetti
             * @default false
             */
            confetti: boolean;
            /**
             * Fog
             * @default false
             */
            fog: boolean;
            /**
             * Sparklers
             * @default false
             */
            sparklers: boolean;
        };
        /** FrameOut */
        FrameOut: {
            /** Description */
            description?: string | null;
            /** Exposure Ok */
            exposure_ok: boolean;
            /** Fixtures */
            fixtures?: string[];
            /** Photo Id */
            photo_id: string;
            /** Sharpness */
            sharpness: number;
            /** Space Guess */
            space_guess?: string | null;
            /** T */
            t: number;
            /** Url */
            url: string;
            /** Usable */
            usable: boolean;
            /** View */
            view?: string | null;
        };
        /** GenerateBase */
        GenerateBase: {
            /** Angle Hint */
            angle_hint?: string | null;
            /** Engine */
            engine?: string | null;
            /** Reference Url */
            reference_url?: string | null;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** ImportOut */
        ImportOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Id */
            id: string;
            /** Name */
            name: string;
            rules: components["schemas"]["VenueRules"];
            /** Skipped Photos */
            skipped_photos: components["schemas"]["SkippedPhoto"][];
            /** Spaces */
            spaces: components["schemas"]["SpaceOut"][];
        };
        /** Install */
        Install: {
            /**
             * Ceiling Draping
             * @default false
             */
            ceiling_draping: boolean;
            /**
             * Uses Adhesives
             * @default false
             */
            uses_adhesives: boolean;
            /**
             * Uses Nails
             * @default false
             */
            uses_nails: boolean;
        };
        /** JobOut */
        JobOut: {
            /** Cancel Requested */
            cancel_requested: boolean;
            /** Error */
            error: string | null;
            /** Error Status */
            error_status: number | null;
            /** Id */
            id: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "render" | "generate_base" | "venue_research" | "video_ingest";
            /** Progress */
            progress: number;
            /** Result */
            result: components["schemas"]["RenderResult"] | components["schemas"]["BaseResult"] | components["schemas"]["ResearchResult"] | components["schemas"]["VideoResult"] | null;
            /**
             * Status
             * @enum {string}
             */
            status: "queued" | "running" | "done" | "failed" | "cancelled";
        };
        /** KimiOptions */
        KimiOptions: {
            /** Bin */
            bin?: string | null;
        };
        /** KimiPatch */
        KimiPatch: {
            /** Bin */
            bin?: string | null;
        };
        /** LanDeviceOut */
        LanDeviceOut: {
            /**
             * Expires At
             * Format: date-time
             */
            expires_at: string;
            /** Id */
            id: string;
            /** Label */
            label: string;
            /**
             * Last Seen
             * Format: date-time
             */
            last_seen: string;
            /**
             * Paired At
             * Format: date-time
             */
            paired_at: string;
        };
        /**
         * LanOptions
         * @description Read-only: reflects whether this run was started with `make dev-lan`.
         */
        LanOptions: {
            /**
             * Enabled
             * @default false
             */
            enabled: boolean;
        };
        /** LanOut */
        LanOut: {
            /** Enabled */
            enabled: boolean;
            /** Pairing Code */
            pairing_code: string | null;
            /** Pairing Expires In */
            pairing_expires_in?: number | null;
            /** Pairing Locked For */
            pairing_locked_for?: number | null;
            /**
             * Pairing Required
             * @default true
             */
            pairing_required: boolean;
            /** Qr Svg */
            qr_svg: string | null;
            /** Url */
            url: string | null;
        };
        /** LastTest */
        LastTest: {
            /**
             * At
             * Format: date-time
             */
            at: string;
            /** Detail */
            detail: string;
            /** Ok */
            ok: boolean;
            /** Seconds */
            seconds: number;
        };
        /** Lighting */
        Lighting: {
            /**
             * Ambient
             * @default evening_warm
             * @enum {string}
             */
            ambient: "daylight" | "evening_warm" | "dim" | "colored";
            /**
             * Pin Spots
             * @default false
             */
            pin_spots: boolean;
            /**
             * String Lights
             * @default false
             */
            string_lights: boolean;
            /** Uplighting */
            uplighting?: string | null;
        };
        /** Linens */
        Linens: {
            /** Color */
            color: string;
            /**
             * Length
             * @default floor
             * @enum {string}
             */
            length: "floor" | "lap" | "none";
            /** Pattern */
            pattern?: string | null;
            /** Runner */
            runner?: string | null;
        };
        /** LookCreate */
        LookCreate: {
            /** Name */
            name: string;
            /** Parent Look Id */
            parent_look_id?: string | null;
            spec: components["schemas"]["DesignSpec"];
        };
        /** LookOut */
        LookOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Parent Look Id */
            parent_look_id: string | null;
            /** Renders */
            renders: components["schemas"]["RenderOut"][];
            /** Space Id */
            space_id: string;
            spec: components["schemas"]["DesignSpec"];
            /** Warnings */
            warnings: components["schemas"]["RuleWarning"][];
        };
        /** Napkins */
        Napkins: {
            /** Color */
            color?: string | null;
            /** Fold */
            fold?: string | null;
        };
        /** PairIn */
        PairIn: {
            /** Code */
            code: string;
        };
        /** PhotoOut */
        PhotoOut: {
            /** Approved */
            approved: boolean;
            /** Credit */
            credit: string | null;
            /** Height */
            height: number;
            /** Id */
            id: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "upload" | "generated_base" | "video_frame" | "web";
            /** Source Page */
            source_page: string | null;
            /** Source Url */
            source_url: string | null;
            /** Space Id */
            space_id: string | null;
            /** Url */
            url: string;
            /** Width */
            width: number;
        };
        /** PhotoReference */
        PhotoReference: {
            /** Caption */
            caption?: string | null;
            /** Credit */
            credit?: string | null;
            /** Source Page */
            source_page: string;
            /** Url */
            url: string;
        };
        /** PhotoSelection */
        PhotoSelection: {
            /**
             * Mode
             * @default reference
             * @enum {string}
             */
            mode: "reference" | "import";
            /**
             * Rights Confirmed
             * @default false
             */
            rights_confirmed: boolean;
            /** Url */
            url: string;
        };
        /** Providers */
        Providers: {
            claude?: components["schemas"]["ClaudeOptions"];
            copilot?: components["schemas"]["CopilotOptions"];
            kimi?: components["schemas"]["KimiOptions"];
        };
        /** ProvidersPatch */
        ProvidersPatch: {
            claude?: components["schemas"]["ClaudePatch"];
            copilot?: components["schemas"]["CopilotOptions"];
            kimi?: components["schemas"]["KimiPatch"];
        };
        /** ReferenceImport */
        ReferenceImport: {
            /**
             * Rights Confirmed
             * @default false
             */
            rights_confirmed: boolean;
            /** Url */
            url: string;
        };
        /** Regenerate */
        Regenerate: {
            /** Engine */
            engine?: string | null;
        };
        /** RenderBatch */
        RenderBatch: {
            /** Jobs */
            jobs: components["schemas"]["JobOut"][];
            /** Renders */
            renders: components["schemas"]["RenderOut"][];
        };
        /** RenderIn */
        RenderIn: {
            /** Brain */
            brain?: string | null;
            /**
             * Brain Qa
             * @default false
             */
            brain_qa: boolean;
            /** Engine */
            engine?: string | null;
            /** Photo Ids */
            photo_ids?: string[] | null;
        };
        /** RenderOut */
        RenderOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Engine */
            engine: string;
            /** Error */
            error: string | null;
            /** Id */
            id: string;
            /** Look Id */
            look_id: string;
            /** Photo Id */
            photo_id: string;
            /** Prompt */
            prompt: string;
            qa: components["schemas"]["RenderQA"] | null;
            /**
             * Status
             * @enum {string}
             */
            status: "queued" | "running" | "done" | "failed" | "cancelled";
            /** Structure Score */
            structure_score: number | null;
            /** Url */
            url: string | null;
        };
        /** RenderQA */
        RenderQA: {
            /** Notes */
            notes?: string | null;
            /** Rule Warnings */
            rule_warnings?: components["schemas"]["RuleWarning"][];
            structure?: components["schemas"]["StructureReport"] | null;
            readonly structure_message: components["schemas"]["StructureMessage"] | null;
            /** Structure Warning */
            structure_warning?: string | null;
            /** Tables Seen */
            tables_seen?: number | null;
        };
        /** RenderResult */
        RenderResult: {
            /** Render Id */
            render_id: string;
        };
        /** ResearchIn */
        ResearchIn: {
            /** Brain */
            brain?: string | null;
            /** Query */
            query: string;
        };
        /** ResearchResult */
        ResearchResult: {
            /** Research */
            research: {
                [key: string]: unknown;
            };
        };
        /** RoleSetup */
        RoleSetup: {
            /** Likely */
            likely: string[];
            /** Missing */
            missing: boolean;
            /** Ready */
            ready: string[];
        };
        /** RuleWarning */
        RuleWarning: {
            /** Field */
            field: string;
            /** Fix */
            fix?: string | null;
            /** Message */
            message: string;
            /** Rule */
            rule: string;
        };
        /** Scene */
        Scene: {
            /** Time Of Day */
            time_of_day?: ("daylight" | "golden_hour" | "evening" | "night") | null;
            /**
             * Windows
             * @default as_photographed
             * @enum {string}
             */
            windows: "as_photographed" | "dark" | "sheer_draped";
        };
        /** SettingsOut */
        SettingsOut: {
            /**
             * Allow Web Research
             * @default true
             */
            allow_web_research: boolean;
            /** Default Brain */
            default_brain?: ("claude" | "codex" | "copilot" | "kimi" | "mock") | null;
            /** Default Engine */
            default_engine?: ("copilot" | "codex" | "mflux" | "mock") | null;
            lan?: components["schemas"]["LanOptions"];
            providers?: components["schemas"]["Providers"];
            /** Setup Completed At */
            setup_completed_at?: string | null;
        };
        /** SettingsPatch */
        SettingsPatch: {
            /**
             * Allow Web Research
             * @default true
             */
            allow_web_research: boolean;
            /** Default Brain */
            default_brain?: ("claude" | "codex" | "copilot" | "kimi" | "mock") | null;
            /** Default Engine */
            default_engine?: ("copilot" | "codex" | "mflux" | "mock") | null;
            lan?: components["schemas"]["LanOptions"];
            providers?: components["schemas"]["ProvidersPatch"];
            /** Setup Completed At */
            setup_completed_at?: string | null;
        };
        /** SetupOut */
        SetupOut: {
            brain: components["schemas"]["RoleSetup"];
            /**
             * Client
             * @enum {string}
             */
            client: "owner" | "phone";
            /** Complete */
            complete: boolean;
            engine: components["schemas"]["RoleSetup"];
            /** Missing */
            missing: ("brain" | "engine" | "defaults")[];
            steps: components["schemas"]["SetupSteps"];
        };
        /** SetupSteps */
        SetupSteps: {
            /** Defaults */
            defaults: boolean;
            /** Tools */
            tools: boolean;
            /** Try It */
            try_it: boolean;
        };
        /** SkippedPhoto */
        SkippedPhoto: {
            /** Reason */
            reason: string;
            /** Url */
            url: string;
        };
        /** SpaceCreate */
        SpaceCreate: {
            /** Name */
            name: string;
            venue_spec?: components["schemas"]["VenueSpec"];
        };
        /** SpaceOut */
        SpaceOut: {
            /** Capacity Seated */
            capacity_seated: number | null;
            /** Capacity Standing */
            capacity_standing: number | null;
            current_spec: components["schemas"]["DesignSpec"] | null;
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Photos */
            photos: components["schemas"]["PhotoOut"][];
            /** References */
            references: components["schemas"]["PhotoReference"][];
            /** Source */
            source: string | null;
            /** Venue Id */
            venue_id: string;
            venue_spec: components["schemas"]["VenueSpec"];
        };
        /** SpacePatch */
        SpacePatch: {
            current_spec?: components["schemas"]["DesignSpec"] | null;
            /** Name */
            name?: string | null;
            venue_spec?: components["schemas"]["VenueSpec"] | null;
        };
        /** SpecCheck */
        SpecCheck: {
            spec: components["schemas"]["DesignSpec"];
            /**
             * Venue Id
             * Format: uuid
             */
            venue_id: string;
        };
        /** SpecCheckResult */
        SpecCheckResult: {
            spec: components["schemas"]["DesignSpec"];
            /** Warnings */
            warnings: components["schemas"]["RuleWarning"][];
        };
        /** StructureMessage */
        StructureMessage: {
            /**
             * Level
             * @enum {string}
             */
            level: "ok" | "unverified" | "changed";
            /** Text */
            text: string;
        };
        /** StructureReport */
        StructureReport: {
            /** Aligned */
            aligned: boolean;
            /** Brightness Delta */
            brightness_delta?: number | null;
            /** Coverage */
            coverage: number | null;
            /** Edge Density */
            edge_density?: number | null;
            /** Flat */
            flat?: boolean | null;
            /** Inliers */
            inliers: number;
            /**
             * Method
             * @enum {string}
             */
            method: "aligned" | "misaligned" | "unverifiable" | "edges" | "gray" | "flat";
            /** Reason */
            reason?: string | null;
            /** Rotation */
            rotation: number | null;
            /** Scale */
            scale: number | null;
            /** Score */
            score: number;
        };
        /** Tables */
        Tables: {
            /** Count */
            count: number;
            /** Seats */
            seats?: number | null;
            /**
             * Shape
             * @enum {string}
             */
            shape: "round" | "banquet" | "square" | "oval" | "cocktail" | "mixed";
            /** Size In */
            size_in?: number | null;
        };
        /** ValidationError */
        ValidationError: {
            /** Context */
            ctx?: Record<string, never>;
            /** Input */
            input?: unknown;
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
        };
        /** VenueCreate */
        VenueCreate: {
            /** Name */
            name: string;
            rules?: components["schemas"]["VenueRules"];
        };
        /** VenueImport */
        VenueImport: {
            /** Accepted Provided Items */
            accepted_provided_items?: string[];
            /** Accepted Rules */
            accepted_rules?: ("live_candles" | "fog" | "confetti" | "sparklers" | "adhesives" | "nails" | "ceiling_draping")[];
            /** Match Index */
            match_index: number;
            /** Photos */
            photos?: components["schemas"]["PhotoSelection"][];
            /**
             * Research Job Id
             * Format: uuid
             */
            research_job_id: string;
            /** Space Names */
            space_names: string[];
        };
        /** VenueOut */
        VenueOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Id */
            id: string;
            /** Name */
            name: string;
            rules: components["schemas"]["VenueRules"];
            /** Spaces */
            spaces: components["schemas"]["SpaceOut"][];
        };
        /** VenuePatch */
        VenuePatch: {
            /** Name */
            name?: string | null;
            rules?: components["schemas"]["VenueRules"] | null;
        };
        /** VenueRules */
        VenueRules: {
            /**
             * Adhesives
             * @default true
             */
            adhesives: boolean;
            /**
             * Ceiling Draping
             * @default true
             */
            ceiling_draping: boolean;
            /**
             * Confetti
             * @default true
             */
            confetti: boolean;
            /**
             * Fog
             * @default true
             */
            fog: boolean;
            /**
             * Live Candles
             * @default true
             */
            live_candles: boolean;
            /**
             * Nails
             * @default true
             */
            nails: boolean;
            /** Notes */
            notes?: string | null;
            /** Provided Items */
            provided_items?: string[] | null;
            /**
             * Sparklers
             * @default true
             */
            sparklers: boolean;
        };
        /** VenueSpec */
        VenueSpec: {
            /** Ceiling Ft */
            ceiling_ft?: number | null;
            /** Fixtures */
            fixtures?: string[] | null;
            /** Floor */
            floor?: string | null;
            /** Length Ft */
            length_ft?: number | null;
            /** Notes */
            notes?: string | null;
            /** Style */
            style?: string | null;
            /** Walls */
            walls?: string | null;
            /** Width Ft */
            width_ft?: number | null;
            /** Windows */
            windows?: string | null;
        };
        /** VideoApply */
        VideoApply: {
            /**
             * Job Id
             * Format: uuid
             */
            job_id: string;
            /** Spaces */
            spaces: components["schemas"]["VideoSpaceIn"][];
        };
        /** VideoResult */
        VideoResult: {
            /**
             * Applied
             * @default false
             */
            applied: boolean;
            /** Duration S */
            duration_s: number;
            /** Frames */
            frames: components["schemas"]["FrameOut"][];
            /** Spaces Suggested */
            spaces_suggested: components["schemas"]["VideoSpaceOut"][];
            /** Warnings */
            warnings: string[];
        };
        /** VideoSpaceIn */
        VideoSpaceIn: {
            /** Name */
            name: string;
            /** Photo Ids */
            photo_ids: string[];
            venue_spec?: components["schemas"]["VenueSpec"];
        };
        /** VideoSpaceOut */
        VideoSpaceOut: {
            /** Name */
            name: string;
            /** Photo Ids */
            photo_ids: string[];
            venue_spec: components["schemas"]["VenueSpec"];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    health_api_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: boolean;
                    };
                };
            };
        };
    };
    list_jobs_api_jobs_get: {
        parameters: {
            query?: {
                space_id?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_job_api_jobs__job_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    cancel_api_jobs__job_id__cancel_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_look_api_looks__look_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                look_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LookOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_look_api_looks__look_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                look_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LookOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    export_look_api_looks__look_id__export_pdf_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                look_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/pdf": string;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    render_look_api_looks__look_id__render_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                look_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["RenderIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RenderBatch"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_photo_api_photos__photo_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                photo_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    approve_photo_api_photos__photo_id__approve_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                photo_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PhotoOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    regenerate_api_renders__render_id__regenerate_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                render_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["Regenerate"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_settings_api_settings_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettingsOut"];
                };
            };
        };
    };
    patch_settings_api_settings_patch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SettingsPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettingsOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_space_api_spaces__space_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                space_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SpaceOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    patch_space_api_spaces__space_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                space_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SpacePatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SpaceOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    chat_history_api_spaces__space_id__chat_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                space_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatMessageOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    chat_api_spaces__space_id__chat_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                space_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChatIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    generate_base_api_spaces__space_id__generate_base_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                space_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenerateBase"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_looks_api_spaces__space_id__looks_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                space_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LookOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_look_api_spaces__space_id__looks_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                space_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LookCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LookOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_photos_api_spaces__space_id__photos_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                space_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_photos_api_spaces__space_id__photos_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PhotoOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    import_reference_api_spaces__space_id__references_import_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                space_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReferenceImport"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PhotoOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    check_spec_api_spec_check_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SpecCheck"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SpecCheckResult"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_default_spec_api_spec_default_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DesignSpec"];
                };
            };
        };
    };
    backends_api_system_backends_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BackendsOut"];
                };
            };
        };
    };
    refresh_backends_api_system_backends_refresh_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BackendsOut"];
                };
            };
        };
    };
    test_backend_api_system_backends__kind___id__test_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                kind: "brain" | "engine";
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["BackendTestIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BackendTestOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    lan_info_api_system_lan_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LanOut"];
                };
            };
        };
    };
    new_code_api_system_lan_code_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LanOut"];
                };
            };
        };
    };
    list_devices_api_system_lan_devices_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LanDeviceOut"][];
                };
            };
        };
    };
    forget_all_devices_api_system_lan_devices_delete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    forget_device_api_system_lan_devices__device_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                device_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    pair_api_system_lan_pair_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PairIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: boolean;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    setup_api_system_setup_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SetupOut"];
                };
            };
        };
    };
    list_venues_api_venues_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VenueOut"][];
                };
            };
        };
    };
    create_venue_api_venues_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VenueCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VenueOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    import_venue_api_venues_import_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VenueImport"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    research_venue_api_venues_research_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResearchIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_venue_api_venues__venue_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                venue_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VenueOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_venue_api_venues__venue_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                venue_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VenueOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    patch_venue_api_venues__venue_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                venue_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VenuePatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VenueOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_space_api_venues__venue_id__spaces_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                venue_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SpaceCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SpaceOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_video_api_venues__venue_id__video_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                venue_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_video_api_venues__venue_id__video_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    apply_video_api_venues__venue_id__video_apply_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                venue_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VideoApply"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VenueOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_test_sample_files_tests__sample_id__png_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sample_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/png": string;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_file_files__path__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                path: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/jpeg": string;
                    "image/png": string;
                    "image/webp": string;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
