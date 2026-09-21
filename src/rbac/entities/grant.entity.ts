import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Permission } from './permission.entity';
import { Role } from './role.entity';

@Entity({ name: 'grants' })
@Index('UQ_grants_role_id_permission_id', ['roleId', 'permissionId'], {
  unique: true,
})
@Index('IDX_grants_permission_id', ['permissionId'])
export class Grant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role!: Role;

  @Column({ name: 'permission_id', type: 'uuid' })
  permissionId!: string;

  @ManyToOne(() => Permission, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'permission_id' })
  permission!: Permission;

  @Column({ type: 'text', array: true, nullable: true })
  actions!: string[] | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
