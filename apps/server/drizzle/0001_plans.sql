CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"guest_token_hash" text,
	"creator_sub" text,
	"rsvp" text,
	"joined_at" timestamp with time zone NOT NULL,
	CONSTRAINT "participants_guest_token_hash_unique" UNIQUE("guest_token_hash"),
	CONSTRAINT "participants_plan_creator_unique" UNIQUE("plan_id","creator_sub"),
	CONSTRAINT "participants_identity_check" CHECK (("participants"."guest_token_hash" is null) <> ("participants"."creator_sub" is null)),
	CONSTRAINT "participants_rsvp_check" CHECK ("participants"."rsvp" is null or "participants"."rsvp" in ('going', 'maybe', 'no'))
);
--> statement-breakpoint
CREATE TABLE "plan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"participant_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb,
	"source_plan_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "plan_events_actor_check" CHECK ("plan_events"."actor" in ('creator', 'participant', 'visitor', 'system'))
);
--> statement-breakpoint
CREATE TABLE "plan_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone,
	"sort_order" integer NOT NULL,
	CONSTRAINT "plan_options_kind_check" CHECK ("plan_options"."kind" in ('time', 'place')),
	CONSTRAINT "plan_options_time_check" CHECK (("plan_options"."kind" = 'time') = ("plan_options"."starts_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_sub" text NOT NULL,
	"title" text NOT NULL,
	"activity" text NOT NULL,
	"area" text,
	"budget_per_person" integer,
	"vote_deadline" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"share_token_hash" text NOT NULL,
	"locked_option_ids" uuid[],
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "plans_share_token_hash_unique" UNIQUE("share_token_hash"),
	CONSTRAINT "plans_status_check" CHECK ("plans"."status" in ('open', 'locked', 'done', 'cancelled', 'expired')),
	CONSTRAINT "plans_activity_check" CHECK ("plans"."activity" in ('coffee', 'dinner', 'movie', 'karaoke', 'day_trip', 'other'))
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"plan_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "votes_participant_id_option_id_pk" PRIMARY KEY("participant_id","option_id")
);
--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_events" ADD CONSTRAINT "plan_events_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_events" ADD CONSTRAINT "plan_events_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_options" ADD CONSTRAINT "plan_options_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_option_id_plan_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."plan_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "participants_plan_id_idx" ON "participants" USING btree ("plan_id","joined_at");--> statement-breakpoint
CREATE INDEX "plan_events_plan_id_idx" ON "plan_events" USING btree ("plan_id","created_at");--> statement-breakpoint
CREATE INDEX "plan_events_type_idx" ON "plan_events" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "plan_options_plan_id_idx" ON "plan_options" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "plans_creator_sub_idx" ON "plans" USING btree ("creator_sub","created_at");--> statement-breakpoint
CREATE INDEX "plans_vote_deadline_idx" ON "plans" USING btree ("vote_deadline");--> statement-breakpoint
CREATE INDEX "votes_option_id_idx" ON "votes" USING btree ("option_id");