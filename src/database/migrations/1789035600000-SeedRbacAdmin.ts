import { MigrationInterface, QueryRunner } from 'typeorm';
export class SeedRbacAdmin1789035600000 implements MigrationInterface {
  name = 'SeedRbacAdmin1789035600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "roles" ("name", "description")
       VALUES ('admin', 'Manages RBAC roles, permissions and grants')
       ON CONFLICT DO NOTHING`,
    );

    await queryRunner.query(
      `INSERT INTO "permissions" ("name", "actions")
       VALUES ('rbac', ARRAY['read', 'create', 'update', 'delete']::text[])
       ON CONFLICT DO NOTHING`,
    );

    await queryRunner.query(
      `INSERT INTO "grants" ("role_id", "permission_id", "actions")
       SELECT "roles"."id", "permissions"."id", NULL::text[]
       FROM "roles", "permissions"
       WHERE "roles"."name" = 'admin' AND "permissions"."name" = 'rbac'
       ON CONFLICT DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "grants"
       WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "name" = 'admin')
         AND "permission_id" IN (SELECT "id" FROM "permissions" WHERE "name" = 'rbac')`,
    );
    await queryRunner.query(`DELETE FROM "permissions" WHERE "name" = 'rbac'`);
    await queryRunner.query(`DELETE FROM "roles" WHERE "name" = 'admin'`);
  }
}
