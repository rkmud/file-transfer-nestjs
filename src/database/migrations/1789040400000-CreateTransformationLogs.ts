import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTransformationLogs1789040400000 implements MigrationInterface {
  name = 'CreateTransformationLogs1789040400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."transformation_logs_type_enum" AS ENUM ('file', 'image')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transformation_logs_status_enum" AS ENUM ('success', 'error')`,
    );
    await queryRunner.query(
      `CREATE TABLE "transformation_logs" (
        "id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "type" "public"."transformation_logs_type_enum" NOT NULL,
        "source_format" character varying(16) NOT NULL,
        "target_format" character varying(16) NOT NULL,
        "status" "public"."transformation_logs_status_enum" NOT NULL,
        "error_code" character varying(64),
        "file_size" bigint NOT NULL,
        "duration_ms" integer NOT NULL,
        "source_file_path" character varying,
        "target_file_path" character varying,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_transformation_logs_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_trans_user_created" ON "transformation_logs" ("user_id", "created_at" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_trans_type_status" ON "transformation_logs" ("type", "status", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_trans_created" ON "transformation_logs" ("created_at" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_trans_source_format" ON "transformation_logs" ("source_format")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_trans_target_format" ON "transformation_logs" ("target_format")`,
    );
    await queryRunner.query(
      `ALTER TABLE "transformation_logs" ADD CONSTRAINT "FK_transformation_logs_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `INSERT INTO "transformation_logs" (
        "id", "user_id", "type", "source_format", "target_format", "status",
        "error_code", "file_size", "duration_ms", "source_file_path",
        "target_file_path", "created_at"
      )
      SELECT
        "id",
        "user_id",
        "type"::text::"public"."transformation_logs_type_enum",
        COALESCE("input_format", 'unknown'),
        "output_format",
        (CASE WHEN "status" = 'SUCCESS' THEN 'success' ELSE 'error' END)::"public"."transformation_logs_status_enum",
        CASE
          WHEN "status" = 'SUCCESS' THEN NULL
          WHEN "error_reason" IS NOT NULL THEN "error_reason"
          WHEN "error_code" = 408 THEN 'TIMEOUT'
          WHEN "error_code" = 413 THEN 'FILE_TOO_LARGE'
          WHEN "error_code" = 415 THEN 'UNSUPPORTED_FORMAT'
          ELSE 'INTERNAL'
        END,
        "input_size",
        COALESCE("duration_ms", 0),
        "input_path",
        "output_path",
        "created_at"
      FROM "conversions"
      WHERE "status" IN ('SUCCESS', 'ERROR')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transformation_logs" DROP CONSTRAINT "FK_transformation_logs_user_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_trans_target_format"`);
    await queryRunner.query(`DROP INDEX "public"."idx_trans_source_format"`);
    await queryRunner.query(`DROP INDEX "public"."idx_trans_created"`);
    await queryRunner.query(`DROP INDEX "public"."idx_trans_type_status"`);
    await queryRunner.query(`DROP INDEX "public"."idx_trans_user_created"`);
    await queryRunner.query(`DROP TABLE "transformation_logs"`);
    await queryRunner.query(
      `DROP TYPE "public"."transformation_logs_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."transformation_logs_type_enum"`,
    );
  }
}
