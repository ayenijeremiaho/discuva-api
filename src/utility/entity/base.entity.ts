import { CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Base entity class that provides common fields (createdAt, updatedAt)
 * to all other entities in the application.
 * This reduces code duplication and ensures consistency.
 */
export abstract class BaseEntity {
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
