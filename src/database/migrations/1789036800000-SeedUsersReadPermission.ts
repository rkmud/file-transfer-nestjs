import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedUsersReadPermission1789036800000 implements MigrationInterface {
  name = 'SeedUsersReadPermission1789036800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "permissions" ("name", "actions")
       VALUES ('users', ARRAY['read']::text[])
       ON CONFLICT DO NOTHING`,
    );

    await queryRunner.query(
      `INSERT INTO "grants" ("role_id", "permission_id", "actions")
       SELECT "roles"."id", "permissions"."id", ARRAY['read']::text[]
       FROM "roles", "permissions"
       WHERE "roles"."name" = 'admin' AND "permissions"."name" = 'users'
       ON CONFLICT DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "grants"
       WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "name" = 'users')`,
    );
    await queryRunner.query(`DELETE FROM "permissions" WHERE "name" = 'users'`);
  }
}
