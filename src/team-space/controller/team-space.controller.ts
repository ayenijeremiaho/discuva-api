import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { TeamSpaceService } from '../service/team-space.service';
import { TeamSpaceExtrasService } from '../service/team-space-extras.service';
import { TeamSpaceKindEnum } from '../entity/team-space.entity';
import {
  AttendanceDto,
  CreateMeetingDto,
  CreatePollDto,
  MinutesDto,
  RsvpDto,
  UpdateMeetingDto,
  VoteDto,
  PinPostDto,
  PostBodyDto,
  ReplyBodyDto,
  SpaceSettingsDto,
} from '../dto/team-space.dto';

const Kind = () => Param('kind', new ParseEnumPipe(TeamSpaceKindEnum));
const Uuid = (name: string) => Param(name, ParseUUIDPipe);

@RequiresModule('team_spaces')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('team-spaces')
export class TeamSpaceController {
  constructor(
    private readonly spaces: TeamSpaceService,
    private readonly extras: TeamSpaceExtrasService,
  ) {}

  @Get('meetings/:postId')
  meeting(@CurrentUser() user: MemberAuth, @Uuid('postId') postId: string) {
    return this.extras.meeting(user.id, postId);
  }

  @Patch('meetings/:postId')
  updateMeeting(
    @CurrentUser() user: MemberAuth,
    @Uuid('postId') postId: string,
    @Body() dto: UpdateMeetingDto,
  ) {
    return this.extras.updateMeeting(user.id, postId, dto);
  }

  @Post('meetings/:postId/rsvp')
  rsvp(
    @CurrentUser() user: MemberAuth,
    @Uuid('postId') postId: string,
    @Body() dto: RsvpDto,
  ) {
    return this.extras.rsvp(user.id, postId, dto.response);
  }

  @Patch('meetings/:postId/minutes')
  minutes(
    @CurrentUser() user: MemberAuth,
    @Uuid('postId') postId: string,
    @Body() dto: MinutesDto,
  ) {
    return this.extras.saveMinutes(user.id, postId, dto.minutes);
  }

  @Patch('meetings/:postId/attendance')
  attendance(
    @CurrentUser() user: MemberAuth,
    @Uuid('postId') postId: string,
    @Body() dto: AttendanceDto,
  ) {
    return this.extras.saveAttendance(user.id, postId, dto.memberIds);
  }

  @Post('polls/:postId/vote')
  vote(
    @CurrentUser() user: MemberAuth,
    @Uuid('postId') postId: string,
    @Body() dto: VoteDto,
  ) {
    return this.extras.vote(user.id, postId, dto.optionIds);
  }

  @Post('polls/:postId/close')
  closePoll(@CurrentUser() user: MemberAuth, @Uuid('postId') postId: string) {
    return this.extras.closePoll(user.id, postId);
  }

  @Get()
  list(@CurrentUser() user: MemberAuth) {
    return this.spaces.list(user.id);
  }

  @Get('posts/:postId')
  thread(
    @CurrentUser() user: MemberAuth,
    @Uuid('postId') postId: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.spaces.thread(user.id, postId, cursor);
  }

  @Patch('posts/:postId')
  editPost(
    @CurrentUser() user: MemberAuth,
    @Uuid('postId') postId: string,
    @Body() dto: PostBodyDto,
  ) {
    return this.spaces.editPost(user.id, postId, dto.body);
  }

  @Delete('posts/:postId')
  removePost(@CurrentUser() user: MemberAuth, @Uuid('postId') postId: string) {
    return this.spaces.removePost(user.id, postId);
  }

  @Post('posts/:postId/pin')
  pin(
    @CurrentUser() user: MemberAuth,
    @Uuid('postId') postId: string,
    @Body() dto: PinPostDto,
  ) {
    return this.spaces.pin(user.id, postId, dto.pinned);
  }

  @Post('posts/:postId/replies')
  reply(
    @CurrentUser() user: MemberAuth,
    @Uuid('postId') postId: string,
    @Body() dto: ReplyBodyDto,
  ) {
    return this.spaces.reply(user.id, postId, dto.body);
  }

  @Patch('replies/:replyId')
  editReply(
    @CurrentUser() user: MemberAuth,
    @Uuid('replyId') replyId: string,
    @Body() dto: ReplyBodyDto,
  ) {
    return this.spaces.editReply(user.id, replyId, dto.body);
  }

  @Delete('replies/:replyId')
  removeReply(
    @CurrentUser() user: MemberAuth,
    @Uuid('replyId') replyId: string,
  ) {
    return this.spaces.removeReply(user.id, replyId);
  }

  @Get(':kind/:refId')
  open(
    @CurrentUser() user: MemberAuth,
    @Kind() kind: TeamSpaceKindEnum,
    @Uuid('refId') refId: string,
  ) {
    return this.spaces.open(user.id, kind, refId);
  }

  @Get(':kind/:refId/posts')
  feed(
    @CurrentUser() user: MemberAuth,
    @Kind() kind: TeamSpaceKindEnum,
    @Uuid('refId') refId: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.spaces.feed(user.id, kind, refId, cursor);
  }

  @Post(':kind/:refId/posts')
  createPost(
    @CurrentUser() user: MemberAuth,
    @Kind() kind: TeamSpaceKindEnum,
    @Uuid('refId') refId: string,
    @Body() dto: PostBodyDto,
  ) {
    return this.spaces.createPost(user.id, kind, refId, dto.body);
  }

  @Post(':kind/:refId/meetings')
  createMeeting(
    @CurrentUser() user: MemberAuth,
    @Kind() kind: TeamSpaceKindEnum,
    @Uuid('refId') refId: string,
    @Body() dto: CreateMeetingDto,
  ) {
    return this.extras.createMeeting(user.id, kind, refId, dto);
  }

  @Post(':kind/:refId/polls')
  createPoll(
    @CurrentUser() user: MemberAuth,
    @Kind() kind: TeamSpaceKindEnum,
    @Uuid('refId') refId: string,
    @Body() dto: CreatePollDto,
  ) {
    return this.extras.createPoll(user.id, kind, refId, dto);
  }

  @Patch(':kind/:refId/settings')
  settings(
    @CurrentUser() user: MemberAuth,
    @Kind() kind: TeamSpaceKindEnum,
    @Uuid('refId') refId: string,
    @Body() dto: SpaceSettingsDto,
  ) {
    return this.spaces.updateSettings(user.id, kind, refId, dto.leadersOnly);
  }
}
