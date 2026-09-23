import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  status!: string;

  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  database!: string;
}
