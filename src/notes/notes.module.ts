import { Module } from '@nestjs/common';
import { NotesController } from './controller/notes.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Note } from './entity/note.entity';
import { NotesService } from './service/notes.service';
import { NotesAnalyticsService } from './service/notes-analytics.service';
import { NotesAnalyticsController } from './controller/notes-analytics.controller';
import { MemberMilestonesController } from './controller/member-milestones.controller';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [TypeOrmModule.forFeature([Note]), UtilityModule],
  providers: [NotesService, NotesAnalyticsService],
  controllers: [
    NotesController,
    NotesAnalyticsController,
    MemberMilestonesController,
  ],
  exports: [TypeOrmModule, NotesService],
})
export class NotesModule {}
