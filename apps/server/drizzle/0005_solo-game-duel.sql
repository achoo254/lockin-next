ALTER TABLE "plans" DROP CONSTRAINT "plans_activity_check";--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "duel" jsonb;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_duel_check" CHECK (("plans"."activity" = 'solo_game') = ("plans"."duel" is not null));--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_activity_check" CHECK ("plans"."activity" in ('coffee', 'dinner', 'movie', 'karaoke', 'solo_game', 'day_trip', 'birthday', 'lunch', 'party', 'team_building', 'meeting', 'other'));