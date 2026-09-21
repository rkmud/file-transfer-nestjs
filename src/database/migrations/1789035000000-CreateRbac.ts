import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRbac1789035000000 implements MigrationInterface {
  name = 'CreateRbac1789035000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "roles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_roles_name" UNIQUE ("name"),
        CONSTRAINT "PK_roles_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "permissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "actions" text array NOT NULL DEFAULT '{}'::text[],
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_permissions_name" UNIQUE ("name"),
        CONSTRAINT "PK_permissions_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "grants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "role_id" uuid NOT NULL,
        "permission_id" uuid NOT NULL,
        "actions" text array,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_grants_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_grants_role_id_permission_id" ON "grants" ("role_id", "permission_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_grants_permission_id" ON "grants" ("permission_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "grants" ADD CONSTRAINT "FK_grants_role_id" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "grants" ADD CONSTRAINT "FK_grants_permission_id" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "user_roles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "role_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_roles_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_user_roles_user_id_role_id" ON "user_roles" ("user_id", "role_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_roles_role_id" ON "user_roles" ("role_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" ADD CONSTRAINT "FK_user_roles_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" ADD CONSTRAINT "FK_user_roles_role_id" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT "FK_user_roles_role_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT "FK_user_roles_user_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_user_roles_role_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_user_roles_user_id_role_id"`,
    );
    await queryRunner.query(`DROP TABLE "user_roles"`);

    await queryRunner.query(
      `ALTER TABLE "grants" DROP CONSTRAINT "FK_grants_permission_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "grants" DROP CONSTRAINT "FK_grants_role_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_grants_permission_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_grants_role_id_permission_id"`,
    );
    await queryRunner.query(`DROP TABLE "grants"`);

    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(`DROP TABLE "roles"`);
  }
}
