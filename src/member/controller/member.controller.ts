import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { LimitedFileInterceptor } from '../../utility/interceptors/limited-file.interceptor';
import { MemberService } from '../service/member.service';
import { MemberStatusEnum } from '../enums/member-status.enum';
import { WorkerStatusEnum } from '../enums/worker-status.enum';
import { MemberRoleEnum } from '../enums/member-role.enum';
import { UpdateMemberDto } from '../dto/update-member.dto';
import { PromoteToWorkerDto } from '../dto/promote-to-worker.dto';
import { BulkPromoteToWorkerDto } from '../dto/bulk-promote-to-worker.dto';
import { UpdateWorkerProfileDto } from '../dto/update-worker-profile.dto';
import { UpdateMyProfileDto } from '../dto/update-my-profile.dto';
import { AssignClergyDto } from '../dto/assign-clergy.dto';
import { SetClergyReviewAccessDto } from '../dto/set-clergy-review-access.dto';
import { SignupDto } from '../dto/signup.dto';
import { plainToInstance } from 'class-transformer';
import { MemberDto } from '../dto/member.dto';
import { WorkerProfileDto } from '../dto/worker-profile.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';

@Controller('members')
export class MemberController {
  constructor(private readonly memberService: MemberService) {}

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_READ)
  @Get()
  async getAll(
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('role') role?: MemberRoleEnum,
    @Query('search') search?: string,
  ) {
    const result = await this.memberService.getAll(+page, +limit, role, search);
    return UtilityService.getPaginationResponseDto(result, MemberDto);
  }

  // Creates a plain MEMBER account (temp password + forced change-password
  // on first login, same as self-signup) — for members without a phone/email
  // habit who need an account set up on their behalf. Promoting to worker
  // afterwards is the existing, separate POST members/:id/promote action.
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Post()
  async createByAdmin(
    @Body() dto: SignupDto,
    @CurrentUser() user: MemberAuth,
  ): Promise<MemberDto> {
    const member = await this.memberService.createByAdmin(dto, user.id);
    return plainToInstance(MemberDto, member, {
      excludeExtraneousValues: true,
    });
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_READ)
  @Get('/workers')
  async getWorkers(
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('status') status?: WorkerStatusEnum,
  ) {
    const result = await this.memberService.getWorkers(+page, +limit, status);
    return UtilityService.getPaginationResponseDto(result, MemberDto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(
    @CurrentUser() user: MemberAuth,
    @Body() dto: UpdateMyProfileDto,
  ): Promise<MemberDto> {
    const member = await this.memberService.updateMyProfile(user.id, dto);
    return plainToInstance(MemberDto, member, {
      excludeExtraneousValues: true,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/photo')
  @UseInterceptors(
    LimitedFileInterceptor(
      'photo',
      Number.parseInt(process.env.MAX_AVATAR_UPLOAD_BYTES ?? '', 10) ||
        3 * 1024 * 1024,
      {
        fileFilter: (_req, file, cb) => {
          if (!file.mimetype.startsWith('image/')) {
            return cb(
              new BadRequestException('Only image files are allowed'),
              false,
            );
          }
          cb(null, true);
        },
      },
    ),
  )
  async updateMyPhoto(
    @CurrentUser() user: MemberAuth,
    @UploadedFile() photo?: Express.Multer.File,
  ): Promise<MemberDto> {
    if (!photo) throw new BadRequestException('No photo provided');
    const member = await this.memberService.updateMyPhoto(user.id, photo);
    return plainToInstance(MemberDto, member, {
      excludeExtraneousValues: true,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/photo')
  async removeMyPhoto(@CurrentUser() user: MemberAuth): Promise<MemberDto> {
    const member = await this.memberService.removeMyPhoto(user.id);
    return plainToInstance(MemberDto, member, {
      excludeExtraneousValues: true,
    });
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_READ)
  @Get(':id')
  async getOne(@Param('id', ParseUUIDPipe) id: string): Promise<MemberDto> {
    const member = await this.memberService.getById(id, [
      'workerProfile',
      'workerProfile.department',
      'clergy',
      'clergy.title',
    ]);
    return plainToInstance(MemberDto, member, {
      excludeExtraneousValues: true,
    });
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Patch(':id')
  async updateMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemberDto,
    @CurrentUser() user: MemberAuth,
  ): Promise<MemberDto> {
    const member = await this.memberService.updateMember(id, dto, user.id);
    return plainToInstance(MemberDto, member, {
      excludeExtraneousValues: true,
    });
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @HttpCode(HttpStatus.OK)
  @Post('bulk-promote')
  async bulkPromoteToWorker(
    @Body() dto: BulkPromoteToWorkerDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.memberService.bulkPromoteToWorker(dto, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Post(':id/promote')
  async promoteToWorker(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PromoteToWorkerDto,
    @CurrentUser() user: MemberAuth,
  ): Promise<MemberDto> {
    const member = await this.memberService.promoteToWorker(id, dto, user.id);
    return plainToInstance(MemberDto, member, {
      excludeExtraneousValues: true,
    });
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Post(':id/revoke-worker')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeWorker(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ): Promise<void> {
    await this.memberService.revokeWorker(id, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Post(':id/demote-trainee')
  @HttpCode(HttpStatus.NO_CONTENT)
  async demoteTraineeToMember(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ): Promise<void> {
    await this.memberService.demoteTraineeToMember(id, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Patch(':id/worker-profile')
  async updateWorkerProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkerProfileDto,
    @CurrentUser() user: MemberAuth,
  ): Promise<WorkerProfileDto> {
    const profile = await this.memberService.updateWorkerProfile(
      id,
      dto,
      user.id,
    );
    return plainToInstance(WorkerProfileDto, profile, {
      excludeExtraneousValues: true,
    });
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Post(':id/clergy')
  async assignClergy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignClergyDto,
    @CurrentUser() user: MemberAuth,
  ): Promise<MemberDto> {
    const member = await this.memberService.assignClergy(id, dto, user.id);
    return plainToInstance(MemberDto, member, {
      excludeExtraneousValues: true,
    });
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Patch(':id/clergy')
  async updateClergyTitle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignClergyDto,
    @CurrentUser() user: MemberAuth,
  ): Promise<MemberDto> {
    const member = await this.memberService.updateClergyTitle(id, dto, user.id);
    return plainToInstance(MemberDto, member, {
      excludeExtraneousValues: true,
    });
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Delete(':id/clergy')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeClergy(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ): Promise<void> {
    await this.memberService.removeClergy(id, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Patch(':id/clergy/review-access')
  async setClergyReviewAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetClergyReviewAccessDto,
    @CurrentUser() user: MemberAuth,
  ): Promise<MemberDto> {
    const member = await this.memberService.setClergyReviewAccess(
      id,
      dto,
      user.id,
    );
    return plainToInstance(MemberDto, member, {
      excludeExtraneousValues: true,
    });
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Delete(':id/photo')
  async removeMemberPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ): Promise<MemberDto> {
    const member = await this.memberService.removeMemberPhoto(id, user.id);
    return plainToInstance(MemberDto, member, {
      excludeExtraneousValues: true,
    });
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Patch(':id/status')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: MemberStatusEnum,
    @CurrentUser() user: MemberAuth,
  ): Promise<void> {
    await this.memberService.changeStatus(id, status, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Post(':id/reset-password')
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ): Promise<{ message: string }> {
    const message = await this.memberService.resetPassword(id, user.id);
    return { message };
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Delete(':id/device')
  @HttpCode(HttpStatus.NO_CONTENT)
  async purgeDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ): Promise<void> {
    await this.memberService.purgeDevice(id, user.id);
  }
}
