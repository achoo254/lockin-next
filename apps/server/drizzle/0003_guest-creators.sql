ALTER TABLE "participants" DROP CONSTRAINT "participants_identity_check";--> statement-breakpoint
ALTER TABLE "plans" ALTER COLUMN "creator_sub" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "is_creator" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Existing creator rows are the ones with an account (the old identity check: guest token xor creator account).
UPDATE "participants" SET "is_creator" = true WHERE "creator_sub" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "creator_token_hash" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "manage_token_enc" text;--> statement-breakpoint
CREATE UNIQUE INDEX "participants_one_creator_idx" ON "participants" USING btree ("plan_id") WHERE "participants"."is_creator";--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_creator_token_hash_unique" UNIQUE("creator_token_hash");--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_creator_sub_check" CHECK ("participants"."creator_sub" is null or "participants"."is_creator");--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_identity_check" CHECK (("participants"."guest_token_hash" is null) = "participants"."is_creator");