import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConversions1789039800000 implements MigrationInterface {
  name = 'CreateConversions1789039800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."conversions_type_enum" AS ENUM ('file', 'image')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."conversions_status_enum" AS ENUM ('PROCESSING', 'SUCCESS', 'ERROR')`,
    );
    await queryRunner.query(
      `CREATE TABLE "conversions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "type" "public"."conversions_type_enum" NOT NULL DEFAULT 'file',
        "input_file_name" character varying(255) NOT NULL,
        "input_format" character varying(16),
        "input_size" integer NOT NULL,
        "input_path" character varying,
        "output_file_name" character varying(255),
        "output_format" character varying(16) NOT NULL,
        "output_size" integer,
        "output_path" character varying,
        "status" "public"."conversions_status_enum" NOT NULL DEFAULT 'PROCESSING',
        "error_code" integer,
        "duration_ms" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_conversions_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversions_user_id_created_at" ON "conversions" ("user_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversions" ADD CONSTRAINT "FK_conversions_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversions" DROP CONSTRAINT "FK_conversions_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_conversions_user_id_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "conversions"`);
    await queryRunner.query(`DROP TYPE "public"."conversions_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."conversions_type_enum"`);
  }
}
