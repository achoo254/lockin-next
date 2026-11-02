ALTER TABLE "plans" DROP CONSTRAINT "plans_activity_check";--> statement-breakpoint
ALTER TABLE "plan_options" ADD COLUMN "map_url" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "group_size" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "share_token_enc" text;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_group_size_check" CHECK ("plans"."group_size" is null or "plans"."group_size" between 2 and 50);--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_activity_check" CHECK ("plans"."activity" in ('coffee', 'dinner', 'movie', 'karaoke', 'day_trip', 'birthday', 'lunch', 'party', 'team_building', 'meeting', 'other'));