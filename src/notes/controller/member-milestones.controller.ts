import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { NotesService } from '../service/notes.service';
import { NoteDto } from '../dto/note.dto';

@UseGuards(JwtAuthGuard)
@Controller('members/me/milestones')
export class MemberMilestonesController {
  constructor(private readonly notesService: NotesService) {}

  @Get()
  async getMyMilestones(@Request() req: any) {
    const notes = await this.notesService.getMyMilestones(req.user.id);
    return plainToInstance(NoteDto, notes, { excludeExtraneousValues: true });
  }
}
