import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixUsersLocaleColumn1789039500000 implements MigrationInterface {
  name = 'FixUsersLocaleColumn1789039500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "users" SET "locale" = 'en' WHERE "locale" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "locale" TYPE character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "locale" SET DEFAULT 'en'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "locale" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "locale" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "locale" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "locale" TYPE character varying(10)`,
    );
  }
}
