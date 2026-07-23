import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { Note } from '../entity/note.entity';
import { NoteTypeEnum } from '../enums/note-type.enums';
import {
  BaptismDetails,
  ChildDedicationDetails,
  ChildNamingDetails,
  MarriageDetails,
} from '../entity/note-details';
import {
  BaptismRequest,
  ChildDedicationRequest,
  ChildNamingRequest,
  MarriageRequest,
} from '../dto/note-request.dto';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { Member } from '../../member/entity/member.entity';

type NoteRequest =
  | ChildNamingRequest
  | ChildDedicationRequest
  | MarriageRequest
  | BaptismRequest;
type UpdateNoteRequest = Partial<NoteRequest> & { type: NoteTypeEnum };

@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);

  constructor(
    @InjectRepository(Note)
    private readonly noteRepository: Repository<Note>,
    private readonly auditLogService: AuditLogService,
  ) {}

  private static async validateRequest(
    type: NoteTypeEnum,
    data: any,
    partial = false,
  ): Promise<void> {
    const classMap = {
      [NoteTypeEnum.CHILD_NAMING]: ChildNamingRequest,
      [NoteTypeEnum.CHILD_DEDICATION]: ChildDedicationRequest,
      [NoteTypeEnum.MARRIAGE]: MarriageRequest,
      [NoteTypeEnum.BAPTISM]: BaptismRequest,
    };

    const RequestClass = classMap[type];
    if (!RequestClass) throw new BadRequestException('Invalid note type');

    const instance = plainToInstance(RequestClass as any, data, {
      exposeDefaultValues: true,
    });
    await validateOrReject(instance as object, {
      skipMissingProperties: partial,
    });
  }

  async create(request: NoteRequest, actorId: string): Promise<Note> {
    await NotesService.validateRequest(request.type, request);

    const note = new Note();
    note.type = request.type;
    note.details = this.buildDetails(request);
    note.member = request.memberId
      ? ({ id: request.memberId } as Member)
      : null;

    const saved = await this.noteRepository.save(note);
    this.logger.log(
      `Note of type ${saved.type} created (id: ${saved.id}) by actor ${actorId}`,
    );
    this.auditLogService.log('NOTE_CREATED', {
      actorId,
      targetId: saved.id,
      metadata: { type: saved.type },
    });
    return saved;
  }

  async update(
    id: string,
    request: UpdateNoteRequest,
    actorId: string,
  ): Promise<Note> {
    if (!request.type) throw new BadRequestException('Note type is required');

    const note = await this.getOrThrow(request.type, id);

    if (note.type !== request.type) {
      throw new BadRequestException('Changing note type is not allowed');
    }

    await NotesService.validateRequest(note.type, request, true);

    note.details = this.mergeDetails(note.type, note.details as any, request);
    if (request.memberId !== undefined) {
      note.member = request.memberId
        ? ({ id: request.memberId } as Member)
        : null;
    }
    const saved = await this.noteRepository.save(note);
    this.auditLogService.log('NOTE_UPDATED', {
      actorId,
      targetId: id,
      metadata: { type: note.type },
    });
    return saved;
  }

  async get(type: NoteTypeEnum, id: string): Promise<Note> {
    return this.getOrThrow(type, id);
  }

  async delete(type: NoteTypeEnum, id: string, actorId: string): Promise<void> {
    const note = await this.getOrThrow(type, id);
    await this.noteRepository.remove(note);
    this.auditLogService.log('NOTE_DELETED', {
      actorId,
      targetId: id,
      metadata: { type },
    });
  }

  async getAll(
    type: NoteTypeEnum,
    page = 1,
    limit = 10,
    order: 'ASC' | 'DESC' = 'DESC',
  ): Promise<PaginationResponseDto<Note>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const [notes, total] = await this.noteRepository.findAndCount({
      where: { type },
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: order },
    });

    return UtilityService.createPaginationResponse(notes, page, limit, total);
  }

  private getOrThrow(type: NoteTypeEnum, id: string): Promise<Note> {
    return this.noteRepository.findOne({ where: { type, id } }).then((note) => {
      if (!note) throw new NotFoundException('Note not found');
      return note;
    });
  }

  private buildDetails(
    request: any,
  ):
    | ChildNamingDetails
    | ChildDedicationDetails
    | MarriageDetails
    | BaptismDetails {
    switch (request.type) {
      case NoteTypeEnum.CHILD_NAMING:
        return {
          ...plainToInstance(ChildNamingDetails, request),
          dateOfBirth: new Date(request.dateOfBirth),
        };
      case NoteTypeEnum.CHILD_DEDICATION:
        return {
          ...plainToInstance(ChildDedicationDetails, request),
          dedicationDate: new Date(request.dedicationDate),
        };
      case NoteTypeEnum.MARRIAGE:
        return {
          ...plainToInstance(MarriageDetails, request),
          weddingDate: new Date(request.weddingDate),
        };
      case NoteTypeEnum.BAPTISM:
        return {
          ...plainToInstance(BaptismDetails, request),
          baptismDate: new Date(request.baptismDate),
        };
      default:
        throw new BadRequestException('Invalid note type');
    }
  }

  private mergeDetails(type: NoteTypeEnum, existing: any, incoming: any): any {
    switch (type) {
      case NoteTypeEnum.CHILD_NAMING:
        return {
          ...existing,
          ...incoming,
          dateOfBirth: incoming.dateOfBirth
            ? new Date(incoming.dateOfBirth)
            : existing.dateOfBirth,
        };
      case NoteTypeEnum.CHILD_DEDICATION:
        return {
          ...existing,
          ...incoming,
          dedicationDate: incoming.dedicationDate
            ? new Date(incoming.dedicationDate)
            : existing.dedicationDate,
        };
      case NoteTypeEnum.MARRIAGE:
        return {
          ...existing,
          ...incoming,
          weddingDate: incoming.weddingDate
            ? new Date(incoming.weddingDate)
            : existing.weddingDate,
        };
      case NoteTypeEnum.BAPTISM:
        return {
          ...existing,
          ...incoming,
          baptismDate: incoming.baptismDate
            ? new Date(incoming.baptismDate)
            : existing.baptismDate,
        };
      default:
        throw new BadRequestException('Unsupported note type');
    }
  }

  async getMyMilestones(memberId: string): Promise<Note[]> {
    return this.noteRepository.find({
      where: { member: { id: memberId } },
      order: { createdAt: 'DESC' },
    });
  }
}
