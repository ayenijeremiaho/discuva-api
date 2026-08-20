import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import 'multer';
import { LimitedFileInterceptor } from '../../utility/interceptors/limited-file.interceptor';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { FinanceRequestService } from '../service/finance-request.service';
import { CreateFinanceRequestDto } from '../dto/finance-request.dto';
import { DepartmentService } from '../../department/service/department.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(MemberRoleEnum.WORKER)
@Controller('finance')
export class FinanceWorkerController {
  constructor(
    private readonly financeRequestService: FinanceRequestService,
    private readonly departmentService: DepartmentService,
  ) {}

  @Get('categories')
  getCategories() {
    return this.financeRequestService.getCategories();
  }

  @Post('requests')
  @UseInterceptors(
    LimitedFileInterceptor(
      'attachment',
      Number.parseInt(process.env.MAX_FINANCE_PROOF_UPLOAD_BYTES ?? '', 10) ||
        10 * 1024 * 1024,
      {
        fileFilter: (_req, file, cb) => {
          const allowed = [
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/webp',
          ];
          if (allowed.includes(file.mimetype)) {
            cb(null, true);
          } else {
            cb(
              new BadRequestException(
                'Only PDF and image files (JPEG, PNG, WebP) are allowed.',
              ),
              false,
            );
          }
        },
      },
    ),
  )
  async createRequest(
    @Body() dto: CreateFinanceRequestDto,
    @CurrentUser() user: MemberAuth,
    @UploadedFile() attachment?: Express.Multer.File,
  ) {
    const departmentId = await this.departmentService.getDepartmentIdForLead(
      user.id,
    );
    if (!departmentId)
      throw new ForbiddenException(
        'Only department heads can raise finance requests',
      );
    if (departmentId !== dto.departmentId)
      throw new ForbiddenException(
        'You can only raise requests for your own department',
      );

    return this.financeRequestService.createRequest(dto, user, attachment);
  }

  @Get('requests')
  async getMyDepartmentRequests(
    @CurrentUser() user: MemberAuth,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const departmentId = await this.departmentService.getDepartmentIdForLead(
      user.id,
    );
    if (!departmentId)
      throw new ForbiddenException(
        'Only department heads can view department finance requests',
      );

    return this.financeRequestService.getMyDepartmentRequests(
      departmentId,
      Number(page),
      Number(limit),
    );
  }

  @Get('requests/:id')
  async getMyRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ) {
    const departmentId = await this.departmentService.getDepartmentIdForLead(
      user.id,
    );
    if (!departmentId)
      throw new ForbiddenException(
        'Only department heads can view finance requests',
      );

    const request = await this.financeRequestService.getRequest(id);
    if (request.department?.id !== departmentId) {
      throw new NotFoundException('Finance request not found');
    }
    return request;
  }
}
