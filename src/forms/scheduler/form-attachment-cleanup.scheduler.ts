import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { FormFieldAttachment } from '../entity/form-field-attachment.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';
import { CloudinaryService } from '../../utility/service/cloudinary.service';

// A FormFieldAttachment row is deleted the instant its upload is claimed by
// a successful submission (FormSubmissionService.saveSubmission) — so any
// row still here past the grace window below was never submitted, either
// abandoned mid-fill or the visitor never hit Submit. Mirrors
// SocialMediaRetentionScheduler's identical "sweep unclaimed uploads" shape.
const ORPHAN_GRACE_HOURS = 48;

@Injectable()
export class FormAttachmentCleanupScheduler {
  private readonly logger = new Logger(FormAttachmentCleanupScheduler.name);

  constructor(
    @InjectRepository(FormFieldAttachment)
    private readonly attachmentRepo: Repository<FormFieldAttachment>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Cron('0 4 * * *')
  async deleteOrphanedAttachments(): Promise<void> {
    const cutoff = new Date(Date.now() - ORPHAN_GRACE_HOURS * 60 * 60 * 1000);

    const result = await forEachActiveTenant(
      this.tenantRepo,
      this.cls,
      this.txHost,
      this.logger,
      async () => {
        const orphaned = await this.attachmentRepo.find({
          where: { createdAt: LessThan(cutoff) },
        });
        if (!orphaned.length) return;

        for (const attachment of orphaned) {
          this.cloudinaryService.deleteByPublicId(
            attachment.publicId,
            attachment.resourceType,
          );
        }
        await this.attachmentRepo.remove(orphaned);
      },
    );

    this.logger.log(
      `Form attachment cleanup sweep: ${result.succeeded} tenant(s) processed, ${result.failed} failed.`,
    );
  }
}
