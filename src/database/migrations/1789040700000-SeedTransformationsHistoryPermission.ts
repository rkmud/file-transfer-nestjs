import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedTransformationsHistoryPermission1789040700000 implements MigrationInterface {
  name = 'SeedTransformationsHistoryPermission1789040700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "permissions" ("name", "actions")
       VALUES ('transformations.history', ARRAY['admin']::text[])
       ON CONFLICT DO NOTHING`,
    );

    await queryRunner.query(
      `INSERT INTO "grants" ("role_id", "permission_id", "actions")
       SELECT "roles"."id", "permissions"."id", ARRAY['admin']::text[]
       FROM "roles", "permissions"
       WHERE "roles"."name" = 'admin' AND "permissions"."name" = 'transformations.history'
       ON CONFLICT DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "grants"
       WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "name" = 'transformations.history')`,
    );
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE "name" = 'transformations.history'`,
    );
  }
}
