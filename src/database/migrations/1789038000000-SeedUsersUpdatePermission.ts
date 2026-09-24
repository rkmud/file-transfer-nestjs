import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedUsersUpdatePermission1789038000000 implements MigrationInterface {
  name = 'SeedUsersUpdatePermission1789038000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "permissions" ("name", "actions")
       VALUES ('users', ARRAY['read', 'update']::text[])
       ON CONFLICT ("name") DO UPDATE
       SET "actions" = ARRAY(
         SELECT DISTINCT unnest("permissions"."actions" || ARRAY['update']::text[])
       )`,
    );

    await queryRunner.query(
      `INSERT INTO "grants" ("role_id", "permission_id", "actions")
       SELECT "roles"."id", "permissions"."id", ARRAY['read', 'update']::text[]
       FROM "roles", "permissions"
       WHERE "roles"."name" = 'admin' AND "permissions"."name" = 'users'
       ON CONFLICT ("role_id", "permission_id") DO UPDATE
       SET "actions" = ARRAY(
         SELECT DISTINCT unnest("grants"."actions" || ARRAY['update']::text[])
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "grants" SET "actions" = array_remove("actions", 'update')
       WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "name" = 'users')`,
    );
    await queryRunner.query(
      `UPDATE "permissions" SET "actions" = array_remove("actions", 'update')
       WHERE "name" = 'users'`,
    );
  }
}
