import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversionErrorReason1789040100000 implements MigrationInterface {
  name = 'AddConversionErrorReason1789040100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversions" ADD "error_reason" character varying(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversions" DROP COLUMN "error_reason"`,
    );
  }
}
