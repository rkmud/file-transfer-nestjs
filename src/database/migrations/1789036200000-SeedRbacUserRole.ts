import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedRbacUserRole1789036200000 implements MigrationInterface {
  name = 'SeedRbacUserRole1789036200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "roles" ("name", "description")
       VALUES ('user', 'Default role assigned on registration')
       ON CONFLICT DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "user_roles"
       WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "name" = 'user')`,
    );
    await queryRunner.query(`DELETE FROM "roles" WHERE "name" = 'user'`);
  }
}
