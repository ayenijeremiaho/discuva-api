import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Public } from '../../auth/decorator/public.decorator';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { PageService } from '../service/page.service';

// No login required — a page is a public marketing surface by definition
// (shared in an ad, etc.). ModuleEnabledGuard still applies: it keys off
// the tenant resolved by TenantMiddleware, not the caller's auth, so an
// unauthenticated visitor of a tenant that hasn't been granted Pages access
// still correctly 404s (see PageAdminController's own comment — Pages is
// early-access, gated entirely through Tenant.moduleOverrides, so a tenant
// without access could never have created a page to view here anyway). Not
// rate-limited — read-only, unlike Forms' public write endpoints.
@Public()
@RequiresModule('pages')
@UseGuards(ModuleEnabledGuard)
@Controller('pages/public')
export class PagePublicController {
  constructor(private readonly pageService: PageService) {}

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.pageService.getForPublic(slug);
  }
}
