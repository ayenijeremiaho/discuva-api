import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Note } from './entity/note.entity';
import { ScriptureLinkTap } from './entity/scripture-link-tap.entity';
import { ServiceSlot } from '../event/entity/service-slot.entity';
import { Sermon } from '../sermon/entity/sermon.entity';
import { NotesService } from './service/notes.service';
import { NotesController } from './controller/notes.controller';
import { AdminNotesController } from './controller/admin-notes.controller';
import { NoteNudgeScheduler } from './scheduler/note-nudge.scheduler';
import { ChurchTimezoneService } from '../event/service/church-timezone.service';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      Note,
      ScriptureLinkTap,
      ServiceSlot,
      Sermon,
    ]),
    // Tenant is public-schema; ChurchTimezoneService reads its timezone.
    TypeOrmModule.forFeature([Tenant]),
  ],
  providers: [NotesService, NoteNudgeScheduler, ChurchTimezoneService],
  controllers: [NotesController, AdminNotesController],
  exports: [NotesService],
})
export class NotesModule {}
