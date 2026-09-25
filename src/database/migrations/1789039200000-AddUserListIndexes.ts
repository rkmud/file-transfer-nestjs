import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserListIndexes1789039200000 implements MigrationInterface {
  name = 'AddUserListIndexes1789039200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_users_email_trgm" ON "users" USING gin ("email" gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_first_name_trgm" ON "users" USING gin ("first_name" gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_last_name_trgm" ON "users" USING gin ("last_name" gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_created_at_id" ON "users" ("created_at", "id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_last_login_at_id" ON "users" ("last_login_at", "id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_last_login_at_id_desc" ON "users" ("last_login_at" DESC NULLS LAST, "id" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_last_login_at_id_desc"`);
    await queryRunner.query(`DROP INDEX "IDX_users_last_login_at_id"`);
    await queryRunner.query(`DROP INDEX "IDX_users_created_at_id"`);
    await queryRunner.query(`DROP INDEX "IDX_users_last_name_trgm"`);
    await queryRunner.query(`DROP INDEX "IDX_users_first_name_trgm"`);
    await queryRunner.query(`DROP INDEX "IDX_users_email_trgm"`);
  }
}
