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
import { TeamSpaceKindEnum } from '../entity/team-space.entity';
import {
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
  constructor(private readonly spaces: TeamSpaceService) {}

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
