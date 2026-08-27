import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import 'multer';
import { DynamicLimitedFileInterceptor } from '../../utility/interceptors/dynamic-limited-file.interceptor';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
import { UPLOAD_HARD_CEILING_BYTES } from '../../platform-admin/constant/known-platform-settings.constant';
import { ClassesService } from '../service/classes.service';
import { GuestService } from '../service/guest.service';
import {
  CreateChurchClassDto,
  UpdateChurchClassDto,
} from '../dto/create-church-class.dto';
import { UpdateClassSessionDto } from '../dto/update-class-session.dto';
import {
  BulkEnrollDto,
  EnrollMemberDto,
  UpdateEnrollmentStatusDto,
} from '../dto/enroll-member.dto';
import { BulkEnrollGuestsDto, EnrollGuestDto } from '../dto/guest.dto';
import { PromoteEnrollmentDto } from '../dto/promote-enrollment.dto';
import { IssueCertificateDto } from '../dto/issue-certificate.dto';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

@RequiresModule('classes')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('classes')
export class ClassesController {
  constructor(
    private readonly classesService: ClassesService,
    private readonly guestService: GuestService,
  ) {}

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Post()
  create(@Body() dto: CreateChurchClassDto) {
    return this.classesService.createClass(dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChurchClassDto,
  ) {
    return this.classesService.updateClass(id, dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.classesService.deleteClass(id);
  }

  @Get()
  findAll(
    @Query('classTypeId') classTypeId?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.classesService.getAllClasses(
      classTypeId,
      Number(page),
      Number(limit),
    );
  }

  @Get('my/enrollments')
  getMyEnrollments(@CurrentUser() user: MemberAuth) {
    return this.classesService.getMyEnrollments(user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Post('materials/upload')
  @UseInterceptors(
    DynamicLimitedFileInterceptor(
      'file',
      PlatformSettingKey.MAX_CLASS_MATERIAL_UPLOAD_MB,
      UPLOAD_HARD_CEILING_BYTES[
        PlatformSettingKey.MAX_CLASS_MATERIAL_UPLOAD_MB
      ],
      {
        fileFilter: (_req, file, cb) => {
          const allowed = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          ];
          if (
            !allowed.includes(file.mimetype) &&
            !file.mimetype.startsWith('image/')
          ) {
            return cb(
              new BadRequestException(
                'Only PDF, Word, PowerPoint, or image files are allowed',
              ),
              false,
            );
          }
          cb(null, true);
        },
      },
    ),
  )
  uploadMaterial(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    return this.classesService.uploadMaterial(file);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_READ)
  @Get('materials/library')
  getMaterialLibrary() {
    return this.classesService.getMaterialLibrary();
  }

  // Minimal id/name/date-range list for the Announcements "Class" audience
  // picker — ANNOUNCEMENTS_WRITE, not CLASSES_READ, mirroring how
  // GET /groups/lookup is gated: composing an announcement shouldn't
  // require a second, separate class-management permission grant. Must
  // stay above the bare ':id' route below.
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.ANNOUNCEMENTS_WRITE)
  @Get('lookup')
  getClassLookup() {
    return this.classesService.getClassLookup();
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_READ)
  @Get('guests')
  listGuests(
    @Query('search') search?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.guestService.list(search, Number(page), Number(limit));
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_READ)
  @Get('guests/:id')
  async getGuest(@Param('id', ParseUUIDPipe) id: string) {
    const [guest, enrollments] = await Promise.all([
      this.guestService.getById(id),
      this.guestService.getEnrollments(id),
    ]);
    return { ...guest, enrollments };
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Post('guests/:guestId/convert-to-member')
  convertGuestToMember(
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.guestService.convertToMember(guestId, user.id);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.classesService.getClass(id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Patch(':id/close')
  closeClass(@Param('id', ParseUUIDPipe) id: string) {
    return this.classesService.closeClass(id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Patch(':id/session')
  updateClassSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassSessionDto,
  ) {
    return this.classesService.updateClassSession(id, dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Post('enroll')
  enroll(@Body() dto: EnrollMemberDto) {
    return this.classesService.enrollMember(dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Post('bulk-enroll')
  bulkEnroll(@Body() dto: BulkEnrollDto) {
    return this.classesService.bulkEnrollMembers(dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Post('enroll/guest')
  enrollGuest(@Body() dto: EnrollGuestDto) {
    return this.classesService.enrollGuest(dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Post('enroll/guests/bulk')
  bulkEnrollGuests(@Body() dto: BulkEnrollGuestsDto) {
    return this.classesService.bulkEnrollGuests(dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Patch('enrollments/:enrollmentId/status')
  updateEnrollmentStatus(
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Body() dto: UpdateEnrollmentStatusDto,
  ) {
    return this.classesService.updateEnrollmentStatus(enrollmentId, dto.status);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_READ)
  @Get('enrollments/:enrollmentId/promotion-candidate')
  getPromotionCandidate(
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
  ) {
    return this.classesService.getPromotionCandidate(enrollmentId);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Post('enrollments/:enrollmentId/promote')
  promoteEnrollment(
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Body() dto: PromoteEnrollmentDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.classesService.promoteEnrollment(enrollmentId, dto, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Patch('enrollments/:enrollmentId/certificate')
  issueCertificate(
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Body() dto: IssueCertificateDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.classesService.issueCertificate(enrollmentId, dto, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_READ)
  @Get(':id/enrollments')
  getClassEnrollments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.classesService.getClassEnrollments(
      id,
      Number(page),
      Number(limit),
    );
  }
}
