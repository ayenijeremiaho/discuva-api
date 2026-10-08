import { Column, Entity, PrimaryColumn } from 'typeorm';

// Daily count of taps on references in versions we can't show, to judge whether a licence is worth it.
@Entity({ name: 'scripture_link_taps' })
export class ScriptureLinkTap {
  @PrimaryColumn({ type: 'date' })
  day: string;

  @PrimaryColumn({ type: 'varchar', length: 16 })
  version: string;

  @Column({ type: 'int', default: 0 })
  count: number;
}
