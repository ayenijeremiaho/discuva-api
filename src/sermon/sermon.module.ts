import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sermon } from './entity/sermon.entity';
import { SermonService } from './service/sermon.service';
import { SermonController } from './controller/sermon.controller';
import { AdminSermonController } from './controller/admin-sermon.controller';
import { UtilityModule } from '../utility/utility.module';
import { AnnouncementModule } from '../announcement/announcement.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Sermon]),
    UtilityModule,
    AnnouncementModule,
  ],
  providers: [SermonService],
  controllers: [SermonController, AdminSermonController],
})
export class SermonModule {}
