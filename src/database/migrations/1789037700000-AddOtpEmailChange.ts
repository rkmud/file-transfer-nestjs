import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOtpEmailChange1789037700000 implements MigrationInterface {
  name = 'AddOtpEmailChange1789037700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."otp_purpose_enum" ADD VALUE IF NOT EXISTS 'email_change'`,
    );
    await queryRunner.query(
      `ALTER TABLE "otp" ADD "new_email" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "otp" WHERE "purpose" = 'email_change'`,
    );
    await queryRunner.query(`ALTER TABLE "otp" DROP COLUMN "new_email"`);
    await queryRunner.query(
      `ALTER TYPE "public"."otp_purpose_enum" RENAME TO "otp_purpose_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."otp_purpose_enum" AS ENUM ('registration', 'password_reset')`,
    );
    await queryRunner.query(
      `ALTER TABLE "otp" ALTER COLUMN "purpose" TYPE "public"."otp_purpose_enum" USING "purpose"::text::"public"."otp_purpose_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."otp_purpose_enum_old"`);
  }
}
