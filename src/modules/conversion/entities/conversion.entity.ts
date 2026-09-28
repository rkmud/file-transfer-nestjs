import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '@/modules/users/users.entity';

export enum ConversionType {
  File = 'file',
  Image = 'image',
}

export enum ConversionStatus {
  Processing = 'PROCESSING',
  Success = 'SUCCESS',
  Error = 'ERROR',
}

@Entity({ name: 'conversions' })
@Index('IDX_conversions_user_id_created_at', ['userId', 'createdAt'])
export class Conversion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({
    type: 'enum',
    enum: ConversionType,
    default: ConversionType.File,
  })
  type!: ConversionType;

  @Column({ name: 'input_file_name', type: 'varchar', length: 255 })
  inputFileName!: string;

  @Column({ name: 'input_format', type: 'varchar', length: 16, nullable: true })
  inputFormat!: string | null;

  @Column({ name: 'input_size', type: 'integer' })
  inputSize!: number;

  @Column({ name: 'input_path', type: 'varchar', nullable: true })
  inputPath!: string | null;

  @Column({
    name: 'output_file_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  outputFileName!: string | null;

  @Column({ name: 'output_format', type: 'varchar', length: 16 })
  outputFormat!: string;

  @Column({ name: 'output_size', type: 'integer', nullable: true })
  outputSize!: number | null;

  @Column({ name: 'output_path', type: 'varchar', nullable: true })
  outputPath!: string | null;

  @Column({
    type: 'enum',
    enum: ConversionStatus,
    default: ConversionStatus.Processing,
  })
  status!: ConversionStatus;

  @Column({ name: 'error_code', type: 'integer', nullable: true })
  errorCode!: number | null;

  @Column({ name: 'duration_ms', type: 'integer', nullable: true })
  durationMs!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
