import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRoleDescription1789035300000 implements MigrationInterface {
  name = 'AddRoleDescription1789035300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roles" ADD "description" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "roles" DROP COLUMN "description"`);
  }
}
