import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadApiResponse, v2 as cloudinary } from 'cloudinary';
import { Readable } from 'node:stream';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';

export type CloudinaryFolder =
  | 'tithes'
  | 'tithe-proofs'
  | 'finance-requests'
  | 'finance-proofs'
  | 'incident-images'
  | 'profile-pictures'
  | 'church-logos'
  | 'tenant-assets'
  | 'class-materials'
  | 'social-media'
  | 'form-covers'
  | 'form-logos'
  | 'form-submissions'
  | 'page-images'
  | 'church-calendar-images';

const FILE_TYPES = ['image', 'video', 'raw'];
const DELETE_BATCH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
  resourceType: string;
  width?: number;
  height?: number;
  // Seconds, video only — undefined for images.
  duration?: number;
}

@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  onModuleInit(): void {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');

    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error(
        'Cloudinary configuration is incomplete. Ensure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are set.',
      );
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    });
    this.logger.log('Cloudinary configured');
  }

  private resolveResourceType(mimeType?: string): 'image' | 'video' | 'raw' {
    if (!mimeType) return 'raw';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    return 'raw';
  }

  async uploadBuffer(
    buffer: Buffer,
    folder: CloudinaryFolder,
    filename?: string,
    mimeType?: string,
  ): Promise<CloudinaryUploadResult> {
    // Each church's own folder is what lets deleting an account remove exactly its files.
    const tenantId = this.cls.get('tenantId');
    const path = tenantId ? `tenants/${tenantId}/${folder}` : folder;
    return this.upload(buffer, `${path}/${filename ?? Date.now()}`, mimeType);
  }

  // A Discuva account's own files, outside every church folder, so deleting a church leaves them alone.
  async uploadAccountFile(
    buffer: Buffer,
    accountId: string,
    folder: CloudinaryFolder,
    mimeType?: string,
  ): Promise<CloudinaryUploadResult> {
    if (!UUID.test(accountId)) {
      throw new Error(`Refusing to upload for account "${accountId}"`);
    }
    return this.upload(
      buffer,
      `accounts/${accountId}/${folder}/${Date.now()}`,
      mimeType,
    );
  }

  // Throws on failure so the caller can retry.
  async deleteAccountFiles(accountId: string): Promise<void> {
    if (!UUID.test(accountId)) {
      throw new Error(`Refusing to delete files for account "${accountId}"`);
    }
    for (const resource_type of FILE_TYPES) {
      let next_cursor: string | undefined;
      do {
        const page = await cloudinary.api.delete_resources_by_prefix(
          `accounts/${accountId}/`,
          { resource_type, type: 'upload', next_cursor },
        );
        next_cursor = page.next_cursor;
      } while (next_cursor);
    }
  }

  private upload(
    buffer: Buffer,
    publicId: string,
    mimeType?: string,
  ): Promise<CloudinaryUploadResult> {
    const resourceType = this.resolveResourceType(mimeType);
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { public_id: publicId, resource_type: resourceType },
        (error, result: UploadApiResponse) => {
          if (error) {
            this.logger.error(`Cloudinary upload failed: ${error.message}`);
            return reject(
              new InternalServerErrorException('File upload failed'),
            );
          }
          resolve({
            secureUrl: result.secure_url,
            publicId: result.public_id,
            resourceType: result.resource_type,
            width: result.width,
            height: result.height,
            duration: result.duration,
          });
        },
      );
      Readable.from(buffer).pipe(stream);
    });
  }

  // Throws on failure so the caller can retry. Older files predate church folders, so they go by id.
  async deleteTenantFiles(
    tenantId: string,
    legacyPublicIds: string[],
  ): Promise<void> {
    if (!UUID.test(tenantId)) {
      throw new Error(`Refusing to delete files for "${tenantId}"`);
    }
    const legacy = legacyPublicIds.filter((id) => !id.startsWith('tenants/'));
    for (const resource_type of FILE_TYPES) {
      let next_cursor: string | undefined;
      do {
        const page = await cloudinary.api.delete_resources_by_prefix(
          `tenants/${tenantId}/`,
          { resource_type, type: 'upload', next_cursor },
        );
        next_cursor = page.next_cursor;
      } while (next_cursor);
      for (let i = 0; i < legacy.length; i += DELETE_BATCH) {
        await cloudinary.api.delete_resources(
          legacy.slice(i, i + DELETE_BATCH),
          { resource_type, type: 'upload' },
        );
      }
    }
  }

  async deleteByPublicId(
    publicId: string,
    resourceType: string,
  ): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
      });
    } catch (err) {
      this.logger.warn(
        `Cloudinary delete failed for ${publicId}: ${(err as Error).message}`,
      );
    }
  }
}
