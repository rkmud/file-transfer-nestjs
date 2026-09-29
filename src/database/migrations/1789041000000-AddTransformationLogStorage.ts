import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTransformationLogStorage1789041000000 implements MigrationInterface {
  name = 'AddTransformationLogStorage1789041000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transformation_logs" ADD "is_stored" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformation_logs" ADD "storage_path" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformation_logs" ADD "expires_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformation_logs" ADD "storage_error_code" character varying(64)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_trans_is_stored" ON "transformation_logs" ("is_stored")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_trans_expires_at" ON "transformation_logs" ("expires_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_trans_expires_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_trans_is_stored"`);
    await queryRunner.query(
      `ALTER TABLE "transformation_logs" DROP COLUMN "storage_error_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformation_logs" DROP COLUMN "expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformation_logs" DROP COLUMN "storage_path"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformation_logs" DROP COLUMN "is_stored"`,
    );
  }
}
