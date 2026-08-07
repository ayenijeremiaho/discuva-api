import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadApiResponse, v2 as cloudinary } from 'cloudinary';
import { Readable } from 'node:stream';

export type CloudinaryFolder =
  | 'tithes'
  | 'tithe-proofs'
  | 'finance-requests'
  | 'finance-proofs'
  | 'incident-images'
  | 'profile-pictures'
  | 'church-logos'
  | 'tenant-assets'
  | 'class-materials';

export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
  resourceType: string;
}

@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private readonly configService: ConfigService) {}

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
    const resourceType = this.resolveResourceType(mimeType);
    return new Promise((resolve, reject) => {
      const publicId = filename
        ? `${folder}/${filename}`
        : `${folder}/${Date.now()}`;
      const stream = cloudinary.uploader.upload_stream(
        { folder, public_id: publicId, resource_type: resourceType },
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
          });
        },
      );
      Readable.from(buffer).pipe(stream);
    });
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
