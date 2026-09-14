import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOtp1789034700000 implements MigrationInterface {
  name = 'CreateOtp1789034700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."otp_purpose_enum" AS ENUM ('registration', 'password_reset')`,
    );
    await queryRunner.query(
      `CREATE TABLE "otp" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "purpose" "public"."otp_purpose_enum" NOT NULL,
        "code_hash" character varying NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "consumed_at" TIMESTAMP WITH TIME ZONE,
        "last_sent_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_otp_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_otp_user_id_purpose" ON "otp" ("user_id", "purpose")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_otp_expires_at" ON "otp" ("expires_at")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_otp_pending_user_id_purpose" ON "otp" ("user_id", "purpose") WHERE "consumed_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "otp" ADD CONSTRAINT "FK_otp_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "otp" DROP CONSTRAINT "FK_otp_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_otp_pending_user_id_purpose"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_otp_expires_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_otp_user_id_purpose"`);
    await queryRunner.query(`DROP TABLE "otp"`);
    await queryRunner.query(`DROP TYPE "public"."otp_purpose_enum"`);
  }
}
