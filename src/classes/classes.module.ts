import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { ChurchClass } from './entity/church-class.entity';
import { ClassEnrollment } from './entity/class-enrollment.entity';
import { ClassType } from './entity/class-type.entity';
import { ClassesService } from './service/classes.service';
import { ClassTypesService } from './service/class-types.service';
import { ClassesController } from './controller/classes.controller';
import { ClassTypesController } from './controller/class-types.controller';
import { MemberModule } from '../member/member.module';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([ChurchClass, ClassEnrollment, ClassType]),
    MemberModule,
    UtilityModule,
  ],
  providers: [ClassesService, ClassTypesService],
  // ClassTypesController must be registered before ClassesController — Nest
  // registers routes in this array's order, and ClassesController's
  // GET /classes/:id would otherwise swallow GET /classes/types (matching
  // "types" as :id) since both are checked as plain 2-segment paths.
  controllers: [ClassTypesController, ClassesController],
  exports: [TenantTypeOrmModule, ClassesService, ClassTypesService],
})
export class ClassesModule {}
