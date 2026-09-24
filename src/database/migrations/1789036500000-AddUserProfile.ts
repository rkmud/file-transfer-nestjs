import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserProfile1789036500000 implements MigrationInterface {
  name = 'AddUserProfile1789036500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "first_name" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "last_name" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "photo" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "phone" character varying`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "bio" character varying`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "locale" character varying NOT NULL DEFAULT 'en'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "locale"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "bio"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phone"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "photo"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "last_name"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "first_name"`);
  }
}
