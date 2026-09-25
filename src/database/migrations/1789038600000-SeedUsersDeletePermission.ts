import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedUsersDeletePermission1789038600000 implements MigrationInterface {
  name = 'SeedUsersDeletePermission1789038600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "permissions" ("name", "actions")
       VALUES ('users', ARRAY['read', 'update', 'delete']::text[])
       ON CONFLICT ("name") DO UPDATE
       SET "actions" = ARRAY(
         SELECT DISTINCT unnest("permissions"."actions" || ARRAY['delete']::text[])
       )`,
    );

    await queryRunner.query(
      `INSERT INTO "grants" ("role_id", "permission_id", "actions")
       SELECT "roles"."id", "permissions"."id", ARRAY['read', 'update', 'delete']::text[]
       FROM "roles", "permissions"
       WHERE "roles"."name" = 'admin' AND "permissions"."name" = 'users'
       ON CONFLICT ("role_id", "permission_id") DO UPDATE
       SET "actions" = ARRAY(
         SELECT DISTINCT unnest("grants"."actions" || ARRAY['delete']::text[])
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "grants" SET "actions" = array_remove("actions", 'delete')
       WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "name" = 'users')`,
    );
    await queryRunner.query(
      `UPDATE "permissions" SET "actions" = array_remove("actions", 'delete')
       WHERE "name" = 'users'`,
    );
  }
}
