import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOtpAccountDeletion1789038300000 implements MigrationInterface {
  name = 'AddOtpAccountDeletion1789038300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."otp_purpose_enum" ADD VALUE IF NOT EXISTS 'account_deletion'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "otp" WHERE "purpose" = 'account_deletion'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."otp_purpose_enum" RENAME TO "otp_purpose_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."otp_purpose_enum" AS ENUM ('registration', 'password_reset', 'email_change')`,
    );
    await queryRunner.query(
      `ALTER TABLE "otp" ALTER COLUMN "purpose" TYPE "public"."otp_purpose_enum" USING "purpose"::text::"public"."otp_purpose_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."otp_purpose_enum_old"`);
  }
}
