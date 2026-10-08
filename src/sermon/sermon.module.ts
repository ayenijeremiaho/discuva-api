import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Sermon } from './entity/sermon.entity';
import { SermonService } from './service/sermon.service';
import { SermonController } from './controller/sermon.controller';
import { AdminSermonController } from './controller/admin-sermon.controller';
import { UtilityModule } from '../utility/utility.module';
import { AnnouncementModule } from '../announcement/announcement.module';
import { NotesModule } from '../notes/notes.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([Sermon]),
    UtilityModule,
    AnnouncementModule,
    NotesModule,
  ],
  providers: [SermonService],
  controllers: [SermonController, AdminSermonController],
})
export class SermonModule {}
