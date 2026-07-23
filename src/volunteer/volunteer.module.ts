import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VolunteerOpportunity } from './entity/volunteer-opportunity.entity';
import { VolunteerSignup } from './entity/volunteer-signup.entity';
import { VolunteerService } from './service/volunteer.service';
import { VolunteerAdminController } from './controller/volunteer-admin.controller';
import { VolunteerController } from './controller/volunteer.controller';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([VolunteerOpportunity, VolunteerSignup]),
    UtilityModule,
  ],
  providers: [VolunteerService],
  controllers: [VolunteerAdminController, VolunteerController],
})
export class VolunteerModule {}
