import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from '@/modules/users/users.entity';
import {
  TRANSFORMATION_STATUSES,
  TRANSFORMATION_TYPES,
  type TransformationStatus,
  type TransformationType,
} from '../transformation-history.types';

const bigintToNumber = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

@Entity({ name: 'transformation_logs' })
@Index('idx_trans_user_created', { synchronize: false })
@Index('idx_trans_type_status', { synchronize: false })
@Index('idx_trans_created', { synchronize: false })
export class TransformationLog {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'enum', enum: TRANSFORMATION_TYPES })
  type!: TransformationType;

  @Index('idx_trans_source_format')
  @Column({ name: 'source_format', type: 'varchar', length: 16 })
  sourceFormat!: string;

  @Index('idx_trans_target_format')
  @Column({ name: 'target_format', type: 'varchar', length: 16 })
  targetFormat!: string;

  @Column({ type: 'enum', enum: TRANSFORMATION_STATUSES })
  status!: TransformationStatus;

  @Column({ name: 'error_code', type: 'varchar', length: 64, nullable: true })
  errorCode!: string | null;

  @Column({ name: 'file_size', type: 'bigint', transformer: bigintToNumber })
  fileSize!: number;

  @Column({ name: 'duration_ms', type: 'integer' })
  durationMs!: number;

  @Column({ name: 'source_file_path', type: 'varchar', nullable: true })
  sourceFilePath!: string | null;

  @Column({ name: 'target_file_path', type: 'varchar', nullable: true })
  targetFilePath!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Index('idx_trans_is_stored')
  @Column({ name: 'is_stored', type: 'boolean', default: false })
  isStored!: boolean;

  @Column({ name: 'storage_path', type: 'varchar', nullable: true })
  storagePath!: string | null;

  @Index('idx_trans_expires_at')
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({
    name: 'storage_error_code',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  storageErrorCode!: string | null;
}
