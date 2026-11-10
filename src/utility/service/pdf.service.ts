import { AccountTypeService } from '../../account-type/account-type.service';
import { WordingRule, applyWording } from '../../account-type/apply-wording';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { jsPDF } from 'jspdf';
import type { FollowUpMonthlyReport } from '../../follow-up/service/follow-up-monthly-report.service';
import autoTable, { RowInput } from 'jspdf-autotable';
import {
  FullEventReport,
  SessionReport,
  SessionSlotReport,
} from '../../service-programme/service/service-session.service';
import { ServiceSessionSlotStatusEnum } from '../../service-programme/enum/service-session-slot-status.enum';
import { ServiceProgramme } from '../../service-programme/entity/service-programme.entity';
import { ServiceProgrammeSlot } from '../../service-programme/entity/service-programme-slot.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { Event as ChurchEvent } from '../../event/entity/event.entity';
import { ServiceSlotTypeLabels } from '../../service-programme/enum/service-slot-type.enum';
import { Member } from '../../member/entity/member.entity';
import {
  ChurchThemeColors,
  churchThemeColors,
} from '../../tenant/constants/church-theme-palette';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { CacheService } from './cache.service';
import { withNetworkBranding } from '../../tenant/util/network-branding';

// Threaded as an explicit parameter through every draw* method that needs
// it, never read off `this` — PdfService is a singleton, and two concurrent
// requests for different tenants interleaving around an `await` could
// otherwise stomp on a shared instance field mid-render (see
// EmailQueueService.resolveBrandingData for the same constraint, solved the
// same way — this is the same fix, just needing parameter-threading instead
// of a single call site since jsPDF drawing is spread across many methods).
interface PdfBranding {
  churchName: string;
  churchAddress: string;
  churchTagline: string;
  currencyCode: string;
  currencyLocale: string;
  // Pre-resolved (fetched + base64-encoded) once per PDF, not a bare URL —
  // jsPDF's addImage draws synchronously, so the network fetch has to
  // happen up front in resolveBranding(), not inside drawPageHeader itself.
  // null whenever there's no logo configured, the fetch fails, or the
  // image's format isn't one jsPDF can embed (anything but PNG/JPEG,
  // e.g. SVG) — every report already renders correctly without a logo,
  // so this only ever adds to the header, never blocks it.
  logoImage: { dataUrl: string; format: 'PNG' | 'JPEG' } | null;
  // IANA zone for rendering times — the server runs in UTC.
  timezone: string;
  // The church's theme preset; Classic reproduces the original black and gold.
  theme: ChurchThemeColors;
  wording: WordingRule[];
}

// The HOD's own department, at the visibility rules already applied by
// DepartmentGoalService.toGoalView — a rating is null here for exactly the
// same reason it would be null in the member API response (not yet both
// submitted), so this export can never leak a one-sided score either.
export interface DepartmentGoalPdfReport {
  departmentName: string;
  cycleName: string;
  stage: string;
  goals: {
    title: string;
    description: string | null;
    timelineToAchieve: string | null;
    selfRating: number | null;
    selfRatingReason: string | null;
    churchRating: number | null;
    churchRatingReason: string | null;
  }[];
}

// One row of a member's Giving Statement — merges TitheRecord (Tithe/
// Offering/General Giving/a GivingOption) and CONFIRMED PledgeContribution
// (pledge-designated gifts) into a single normalized shape, since the two
// live in separate tables but both count as the member's giving. `type` is
// the human-readable purpose (e.g. "General Giving", "Building Fund",
// "Pledge: Roof Repair Fund") computed by the caller.
export interface GivingStatementLine {
  paymentDate: string;
  amount: number;
  type: string;
  // Sender's bank for transfers, or the online provider (e.g. Paystack).
  paidVia: string | null;
  reference: string | null;
}

export interface AccountDataPdf {
  name: string;
  timezone: string;
  exportedAt: Date;
  accountCreatedAt: Date;
  photoUrl: string | null;
  // Label and value, in reading order.
  profile: [string, string][];
  milestones: {
    when: string;
    what: string;
    where: string;
    recordedBy: string;
    shownTo: string;
  }[];
  churches: { name: string; linkedAt: Date }[];
}

export interface ClassCertificatePdf {
  recipientName: string;
  className: string;
  classTypeName: string | null;
  completedOn: string;
  certificateNumber: string | null;
  signatories: string[];
}

const DARK = '#121212';
const MUTED = '#8A817C';
const DANGER = '#C0392B';
const SUCCESS = '#2E7D32';
const WHITE = '#FFFFFF';
const WATCH = '#B26A00';

type StatTone = 'good' | 'watch' | 'bad' | undefined;
// Fixed meaning colours, the same on every church theme: green going well, amber to watch, red to act on.
const TONES: Record<'good' | 'watch' | 'bad', { ink: string; fill: string }> = {
  good: { ink: '#2E7D32', fill: '#EAF5EC' },
  watch: { ink: WATCH, fill: '#FFF4E3' },
  bad: { ink: '#B42318', fill: '#FDECEA' },
};

const PAGE_W = 210;
const MARGIN = 18;
// autoTable's default padding, with extra room between right-aligned amounts and the next column.
const AMOUNT_PAD = { top: 1.76, bottom: 1.76, left: 1.76, right: 5 };
const CONTENT_W = PAGE_W - MARGIN * 2;

@Injectable()
export class PdfService {
  private readonly cacheTtl: number;

  constructor(
    private readonly config: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly cacheService: CacheService,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    private readonly accountTypes: AccountTypeService,
  ) {
    this.cacheTtl = this.config.get<number>('CACHE_TTL_REFERENCE_SECONDS', 300);
  }

  // Shares the same `tenant-branding:${tenantId}` cache entry
  // EmailQueueService populates — same underlying Tenant row, so no reason
  // for a second cache key/DB round trip. currencyLocale has no tenant-scoped
  // equivalent (Tenant has no locale column) and stays a pure global default.
  private async resolveBranding(): Promise<PdfBranding> {
    const fallback: PdfBranding = {
      churchName: this.config.get<string>('PRODUCT_NAME'),
      churchAddress: '',
      churchTagline: '',
      currencyCode: this.config.get<string>('CURRENCY_CODE'),
      currencyLocale: this.config.get<string>('CURRENCY_LOCALE'),
      logoImage: null,
      timezone: this.config.get<string>('TIMEZONE') ?? 'Africa/Lagos',
      theme: churchThemeColors(null),
      wording: [],
    };

    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return fallback;

    const tenant = await this.cacheService.getOrSet(
      `tenant-branding:${tenantId}`,
      () =>
        this.tenantRepository
          .findOneBy({ id: tenantId })
          .then((t) => withNetworkBranding(this.tenantRepository, t)),
      this.cacheTtl,
    );
    if (!tenant) return fallback;

    const logoImage = tenant.logoUrl
      ? await this.resolveLogoImage(tenant.logoUrl)
      : null;

    return {
      churchName: tenant.name || fallback.churchName,
      churchAddress: tenant.address || '',
      churchTagline: tenant.tagline || '',
      currencyCode: tenant.currency || fallback.currencyCode,
      currencyLocale: fallback.currencyLocale,
      logoImage,
      timezone: tenant.timezone || fallback.timezone,
      theme: churchThemeColors(tenant.themePreset),
      wording: await this.accountTypes
        .wordingFor(tenant.orgType)
        .catch(() => []),
    };
  }

  // Cached by URL (not tenantId) alongside the branding cache above, same
  // TTL — a broken/unreachable logo URL caches its `null` result too, so a
  // bad URL doesn't turn into a repeated-fetch penalty on every PDF.
  private async resolveLogoImage(
    logoUrl: string,
  ): Promise<{ dataUrl: string; format: 'PNG' | 'JPEG' } | null> {
    return this.cacheService.getOrSet(
      `pdf-logo-image:${logoUrl}`,
      () => this.fetchImage(logoUrl),
      this.cacheTtl,
    );
  }

  // Images print at a few centimetres; a full-size upload made a two-page report several megabytes.
  private async fetchImage(
    url: string,
  ): Promise<{ dataUrl: string; format: 'PNG' | 'JPEG' } | null> {
    try {
      const res = await fetch(
        url.replace(
          /(res\.cloudinary\.com\/[^/]+\/image\/upload\/)(?!c_limit)/,
          '$1c_limit,w_240,h_240/',
        ),
      );
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') ?? '';
      const format = contentType.includes('png')
        ? 'PNG'
        : contentType.includes('jpeg') || contentType.includes('jpg')
          ? 'JPEG'
          : null;
      if (!format) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      return {
        dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
        format,
      };
    } catch {
      return null;
    }
  }

  // The person's own copy of their Discuva account: Discuva's look, not any one church's.
  async generateAccountData(data: AccountDataPdf): Promise<Buffer> {
    const branding: PdfBranding = {
      churchName: 'Discuva',
      churchAddress: 'Your own copy of what your Discuva account holds',
      churchTagline: 'Your data',
      currencyCode: '',
      currencyLocale: 'en-GB',
      logoImage: null,
      timezone: data.timezone,
      theme: churchThemeColors(null),
      wording: [],
    };
    const photo = data.photoUrl ? await this.fetchImage(data.photoUrl) : null;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    this.drawAccountData(doc, data, branding, photo);
    return Buffer.from(doc.output('arraybuffer'));
  }

  private drawAccountData(
    doc: jsPDF,
    data: AccountDataPdf,
    branding: PdfBranding,
    photo: { dataUrl: string; format: 'PNG' | 'JPEG' } | null,
  ): void {
    let y = this.drawPageHeader(doc, 'Your Discuva Data', branding);
    y = this.drawAccentBand(
      doc,
      branding.theme,
      y,
      data.name,
      `Downloaded ${this.fmtDate(data.exportedAt, data.timezone)}`,
      'Account since',
      this.fmtDate(data.accountCreatedAt, data.timezone),
    );

    y += 8;
    y = this.drawAccountSectionTitle(doc, y, 'Profile');
    let gridX = 0;
    if (photo) {
      try {
        doc.addImage(
          photo.dataUrl,
          photo.format,
          MARGIN,
          y,
          24,
          24,
          undefined,
          'FAST',
        );
        gridX = 28;
      } catch {
        gridX = 0;
      }
    }
    const gridTop = y + 2;
    const pairs = data.profile;
    const colW = (CONTENT_W - gridX) / 2;
    pairs.forEach(([label, value], i) => {
      const x = MARGIN + gridX + (i % 2) * colW;
      const row = gridTop + Math.floor(i / 2) * 9;
      doc
        .setFont('helvetica', 'normal')
        .setFontSize(8)
        .setTextColor(MUTED)
        .text(label, x, row);
      doc
        .setFont('helvetica', 'bold')
        .setFontSize(9)
        .setTextColor(DARK)
        .text(doc.splitTextToSize(value || '—', colW - 4)[0], x, row + 4);
    });
    y =
      Math.max(
        gridTop + Math.ceil(pairs.length / 2) * 9,
        y + (photo ? 26 : 0),
      ) + 6;

    y = this.drawAccountSectionTitle(doc, y, 'Milestones');
    if (data.milestones.length) {
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN, bottom: 22 },
        head: [['When', 'Milestone', 'Where', 'Recorded by', 'Shown to']],
        body: data.milestones.map((m) => [
          m.when || '—',
          m.what,
          m.where || '—',
          m.recordedBy,
          m.shownTo,
        ]),
        headStyles: {
          fillColor: branding.theme.accent,
          textColor: DARK,
          fontStyle: 'bold',
          fontSize: 9,
        },
        bodyStyles: { fontSize: 9, textColor: DARK, fillColor: WHITE },
        alternateRowStyles: { fillColor: branding.theme.soft },
      });
      y = this.tableEnd(doc) + 8;
    } else {
      y = this.drawAccountNote(doc, y, 'No milestones yet.') + 6;
    }

    y = this.drawAccountSectionTitle(doc, y, 'Your churches');
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, bottom: 22 },
      head: [['Church', 'On your account since']],
      body: data.churches.map((c) => [
        c.name,
        this.fmtDate(c.linkedAt, data.timezone),
      ]),
      headStyles: {
        fillColor: branding.theme.accent,
        textColor: DARK,
        fontStyle: 'bold',
        fontSize: 9,
      },
      bodyStyles: { fontSize: 9, textColor: DARK, fillColor: WHITE },
      alternateRowStyles: { fillColor: branding.theme.soft },
    });
    y = this.tableEnd(doc) + 8;

    this.drawAccountNote(
      doc,
      y,
      'Each church keeps its own records, such as attendance and giving. Ask that church for a copy.',
    );
    this.drawPageFooter(doc, branding);
  }

  private drawAccountSectionTitle(
    doc: jsPDF,
    y: number,
    title: string,
  ): number {
    if (y > 260) {
      doc.addPage();
      y = 20;
    }
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(11)
      .setTextColor(DARK)
      .text(title, MARGIN, y);
    return y + 5;
  }

  private drawAccountNote(doc: jsPDF, y: number, text: string): number {
    if (y > 268) {
      doc.addPage();
      y = 20;
    }
    const lines = doc
      .setFont('helvetica', 'normal')
      .setFontSize(9)
      .splitTextToSize(text, CONTENT_W);
    doc.setTextColor(MUTED).text(lines, MARGIN, y);
    return y + lines.length * 4.5;
  }

  private tableEnd(doc: jsPDF): number {
    return (doc as unknown as { lastAutoTable: { finalY: number } })
      .lastAutoTable.finalY;
  }

  // Landscape certificate of completion for a training class, in the church's branding.
  async generateClassCertificate(cert: ClassCertificatePdf): Promise<Buffer> {
    const branding = await this.resolveBranding();
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });
    const W = 297;
    const H = 210;
    const mid = W / 2;

    doc.setDrawColor(branding.theme.accent);
    doc.setLineWidth(3);
    doc.rect(8, 8, W - 16, H - 16);
    doc.setDrawColor(branding.theme.brand);
    doc.setLineWidth(0.4);
    doc.rect(13, 13, W - 26, H - 26);

    let y = 42;
    if (branding.logoImage) {
      try {
        doc.addImage(
          branding.logoImage.dataUrl,
          branding.logoImage.format,
          mid - 11,
          24,
          22,
          22,
          undefined,
          'FAST',
        );
        y = 56;
      } catch {
        // drawn without a logo
      }
    }
    doc.setTextColor(MUTED);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text((branding.churchName ?? '').toUpperCase(), mid, y, {
      align: 'center',
    });

    doc.setTextColor(DARK);
    doc.setFont('times', 'normal');
    doc.setFontSize(34);
    doc.text('Certificate of Completion', mid, y + 20, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(MUTED);
    doc.text('This is to certify that', mid, y + 36, { align: 'center' });

    doc.setTextColor(DARK);
    doc.setFont('times', 'bold');
    doc.setFontSize(28);
    doc.text(cert.recipientName, mid, y + 52, { align: 'center' });
    doc.setDrawColor(branding.theme.accent);
    doc.setLineWidth(0.6);
    doc.line(mid - 80, y + 56, mid + 80, y + 56);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(MUTED);
    doc.text('has successfully completed', mid, y + 68, { align: 'center' });
    doc.setTextColor(DARK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(cert.className, mid, y + 79, { align: 'center' });
    if (cert.classTypeName && cert.classTypeName !== cert.className) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(MUTED);
      doc.text(cert.classTypeName, mid, y + 86, { align: 'center' });
    }

    const baseY = H - 38;
    doc.setFontSize(10);
    doc.setTextColor(DARK);
    doc.setFont('helvetica', 'normal');
    const signers = cert.signatories.slice(0, 2);
    const slots = signers.length ? signers : [''];
    slots.forEach((name, i) => {
      const x = slots.length === 1 ? 60 : 45 + i * 70;
      doc.setDrawColor(branding.theme.brand);
      doc.setLineWidth(0.3);
      doc.line(x - 25, baseY, x + 25, baseY);
      doc.text(name || 'Facilitator', x, baseY + 5, { align: 'center' });
    });
    doc.text(`Completed ${cert.completedOn}`, W - 60, baseY, {
      align: 'center',
    });
    if (cert.certificateNumber) {
      doc.setTextColor(MUTED);
      doc.text(`Certificate No. ${cert.certificateNumber}`, W - 60, baseY + 5, {
        align: 'center',
      });
    }
    return Buffer.from(doc.output('arraybuffer'));
  }

  async generateSessionReport(report: SessionReport): Promise<Buffer> {
    const branding = await this.resolveBranding();
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    this.drawSessionReport(doc, report, branding);
    return Buffer.from(doc.output('arraybuffer'));
  }

  async generateFullEventReport(report: FullEventReport): Promise<Buffer> {
    const branding = await this.resolveBranding();
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    this.drawFullEventReport(doc, report, branding);
    return Buffer.from(doc.output('arraybuffer'));
  }

  async generateGivingStatement(
    member: Member,
    lines: GivingStatementLine[],
    period?: { from?: string; to?: string },
    title = 'Giving Statement',
  ): Promise<Buffer> {
    const branding = await this.resolveBranding();
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    this.drawGivingStatement(doc, member, lines, branding, period, title);
    return Buffer.from(doc.output('arraybuffer'));
  }

  async generateEventSummaryReport(report: FullEventReport): Promise<Buffer> {
    const branding = await this.resolveBranding();
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    this.drawEventSummaryReport(doc, report, branding);
    return Buffer.from(doc.output('arraybuffer'));
  }

  async generateProgrammeDraft(programme: ServiceProgramme): Promise<Buffer> {
    const branding = await this.resolveBranding();
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    this.drawProgrammeDraft(doc, programme, branding);
    return Buffer.from(doc.output('arraybuffer'));
  }

  async generateEventProgramme(
    event: ChurchEvent,
    sections: Array<{ slot: ServiceSlot; programme: ServiceProgramme | null }>,
  ): Promise<Buffer> {
    const branding = await this.resolveBranding();
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    this.drawEventProgramme(doc, event, sections, branding);
    return Buffer.from(doc.output('arraybuffer'));
  }

  async generateDepartmentGoalReport(
    report: DepartmentGoalPdfReport,
  ): Promise<Buffer> {
    const branding = await this.resolveBranding();
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    this.drawDepartmentGoalReport(doc, report, branding);
    return Buffer.from(doc.output('arraybuffer'));
  }

  async generateFollowUpMonthlyReport(
    report: FollowUpMonthlyReport,
  ): Promise<Buffer> {
    const branding = await this.resolveBranding();
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    this.drawFollowUpMonthlyReport(doc, report, branding);
    return Buffer.from(doc.output('arraybuffer'));
  }

  // ─── Session report ──────────────────────────────────────────────────────

  private drawSessionReport(
    doc: jsPDF,
    report: SessionReport,
    branding: PdfBranding,
  ): void {
    let y = this.drawPageHeader(
      doc,
      applyWording('Service Session Report', branding.wording),
      branding,
    );

    y = this.drawAccentBand(
      doc,
      branding.theme,
      y,
      report.programme.serviceSlotName ?? 'Session',
      this.fmtDate(report.startedAt, branding.timezone),
    );

    y = this.drawLabelValueGrid(doc, y + 4, [
      ['Session Code', report.sessionCode],
      ['Started', this.fmtTime(report.startedAt, branding.timezone)],
      [
        'Ended',
        report.endedAt ? this.fmtTime(report.endedAt, branding.timezone) : '—',
      ],
      [
        'Duration',
        report.totalDurationMinutes == null
          ? '—'
          : `${report.totalDurationMinutes} min`,
      ],
      ['Slots Completed', `${report.completedSlots} / ${report.totalSlots}`],
      ['Completion Rate', `${report.completionRate}%`],
      ['Pauses', `${report.pauseCount}`],
      [
        'Total Pause Time',
        `${Math.round(report.totalPauseDurationSeconds / 60)} min`,
      ],
    ]);

    y += 8;
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(11)
      .setTextColor(DARK)
      .text('Slots', MARGIN, y);
    y += 5;

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [
        ['#', 'Topic', 'Speaker', 'Time', 'Allocated', 'Actual', 'Overrun'],
      ],
      body: report.slots.map((slot) => {
        let overrun = '—';
        if (slot.overrunSeconds != null) {
          const mins = Math.round(slot.overrunSeconds / 60);
          overrun = mins > 0 ? `+${mins} min` : `${mins} min`;
        }
        return [
          String(slot.position + 1),
          this.slotTopicLabel(slot),
          slot.speakerName ?? '—',
          this.fmtSlotTimeRange(slot, branding.timezone),
          slot.allocatedMinutes == null ? '—' : `${slot.allocatedMinutes} min`,
          slot.actualSeconds == null
            ? '—'
            : `${Math.round(slot.actualSeconds / 60)} min`,
          overrun,
        ];
      }),

      columnStyles: {
        0: { cellWidth: 8 },
        1: { cellWidth: 40 },
        2: { cellWidth: 30 },
        3: { cellWidth: 32 },
        4: { cellWidth: 18 },
        5: { cellWidth: 18 },
        6: { cellWidth: 28 },
      },
      headStyles: {
        fillColor: branding.theme.accent,
        textColor: DARK,
        fontStyle: 'bold',
        fontSize: 9,
      },
      bodyStyles: { fontSize: 9, textColor: DARK, fillColor: WHITE },
      alternateRowStyles: { fillColor: branding.theme.soft },
      didParseCell: (data) => {
        if (
          data.section === 'body' &&
          data.column.index === 6 &&
          typeof data.cell.raw === 'string' &&
          data.cell.raw.startsWith('+')
        ) {
          data.cell.styles.textColor = DANGER;
        }
        const rowSlot = report.slots[data.row.index];
        if (
          data.section === 'body' &&
          rowSlot?.status === ServiceSessionSlotStatusEnum.SKIPPED
        ) {
          data.cell.styles.textColor = MUTED;
        }
      },
    });

    const afterSlotsY = (doc as any).lastAutoTable.finalY + 8;

    if (report.pauses.length > 0) {
      doc
        .setFont('helvetica', 'bold')
        .setFontSize(11)
        .setTextColor(DARK)
        .text('Pause Log', MARGIN, afterSlotsY);

      autoTable(doc, {
        startY: afterSlotsY + 5,
        margin: { left: MARGIN, right: MARGIN },
        head: [['Slot', 'Reason', 'Duration']],
        body: report.pauses.map((p) => [
          this.pauseSlotLabel(p.slotPosition, report.slots),
          p.reason.replaceAll('_', ' '),
          p.durationSeconds == null
            ? 'ongoing'
            : `${Math.round(p.durationSeconds / 60)} min`,
        ]),
        columnStyles: {
          0: { cellWidth: 24 },
          1: { cellWidth: 120 },
          2: { cellWidth: 30 },
        },
        headStyles: {
          fillColor: branding.theme.accent,
          textColor: DARK,
          fontStyle: 'bold',
          fontSize: 9,
        },
        bodyStyles: { fontSize: 9, textColor: MUTED, fillColor: WHITE },
        alternateRowStyles: { fillColor: branding.theme.soft },
      });
    }

    const finalY = (doc as any).lastAutoTable.finalY;
    const cursorY = this.drawAnalysisSection(doc, finalY + 8, report);

    const summaryY =
      cursorY + 14 > 277
        ? (() => {
            doc.addPage();
            return MARGIN;
          })()
        : cursorY;
    this.drawTimeSummaryBand(doc, branding.theme, summaryY, report);

    this.drawPageFooter(doc, branding);
  }

  // ─── Tithe statement ─────────────────────────────────────────────────────

  // Lines arrive newest first; each month opens with a shaded row carrying its subtotal.
  private givingStatementRows(
    lines: GivingStatementLine[],
    branding: PdfBranding,
  ): RowInput[] {
    const money = (n: number) =>
      n.toLocaleString(branding.currencyLocale, { minimumFractionDigits: 2 });
    const months = new Map<string, GivingStatementLine[]>();
    for (const line of lines) {
      const key = line.paymentDate.slice(0, 7);
      months.set(key, [...(months.get(key) ?? []), line]);
    }
    const rows: RowInput[] = [];
    for (const [key, monthLines] of months) {
      const [yr, mo] = key.split('-').map(Number);
      const monthName = new Date(yr, mo - 1, 1).toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
      });
      const shade = {
        fillColor: branding.theme.soft,
        fontStyle: 'bold' as const,
      };
      rows.push([
        { content: monthName, colSpan: 2, styles: shade },
        {
          content: money(
            monthLines.reduce((sum, l) => sum + Number(l.amount), 0),
          ),
          styles: { ...shade, halign: 'right', cellPadding: AMOUNT_PAD },
        },
        { content: '', colSpan: 2, styles: shade },
      ]);
      for (const r of monthLines) {
        rows.push([
          r.paymentDate,
          r.type,
          money(Number(r.amount)),
          r.paidVia ?? '—',
          r.reference ?? '—',
        ]);
      }
    }
    return rows;
  }

  private drawGivingStatement(
    doc: jsPDF,
    member: Member,
    lines: GivingStatementLine[],
    branding: PdfBranding,
    period?: { from?: string; to?: string },
    title = 'Giving Statement',
  ): void {
    let y = this.drawPageHeader(doc, title, branding);

    const total = lines.reduce((sum, r) => sum + Number(r.amount), 0);
    const money = (n: number) =>
      n.toLocaleString(branding.currencyLocale, { minimumFractionDigits: 2 });

    const generatedText = `Generated: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: branding.timezone })}`;

    let periodLabel: string | undefined;
    let periodValue: string | undefined;
    if (period?.from && period?.to) {
      periodLabel = 'Period';
      periodValue = `${this.fmtMonthShort(period.from)} – ${this.fmtMonthShort(period.to)}`;
    } else if (period?.from) {
      periodLabel = 'From';
      periodValue = `${this.fmtMonthShort(period.from)} onwards`;
    } else if (period?.to) {
      periodLabel = 'Up to';
      periodValue = this.fmtMonthShort(period.to);
    }

    y = this.drawAccentBand(
      doc,
      branding.theme,
      y,
      `${this.cap(member.firstname)} ${this.cap(member.lastname)}`,
      generatedText,
      periodLabel,
      periodValue,
    );

    y = this.drawLabelValueGrid(doc, y + 4, [
      ['Email', member.email],
      ['Phone', member.phoneNumber ?? '—'],
      ['Total Records', `${lines.length}`],
      [
        `Total Paid (${branding.currencyCode})`,
        total.toLocaleString(branding.currencyLocale, {
          minimumFractionDigits: 2,
        }),
      ],
    ]);

    y += 8;
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(11)
      .setTextColor(DARK)
      .text('Payment History', MARGIN, y);
    y += 5;

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [
        [
          'Date',
          'Type',
          `Amount (${branding.currencyCode})`,
          'Paid Via',
          'Reference',
        ],
      ],
      body: this.givingStatementRows(lines, branding),
      foot: [['Total', '', money(total), '', '']],

      // 174mm between the margins; Reference takes what's left.
      columnStyles: {
        0: { cellWidth: 21 },
        1: { cellWidth: 34 },
        2: { cellWidth: 31, halign: 'right', cellPadding: AMOUNT_PAD },
        3: { cellWidth: 26 },
        // Online references are 43 characters; 7.5pt keeps them on one line.
        4: { cellWidth: 'auto', fontSize: 7.5 },
      },
      headStyles: {
        fillColor: branding.theme.accent,
        textColor: DARK,
        fontStyle: 'bold',
        fontSize: 9,
      },
      bodyStyles: { fontSize: 9, textColor: DARK, fillColor: WHITE },
      alternateRowStyles: { fillColor: WHITE },
      footStyles: {
        fillColor: branding.theme.brand,
        textColor: WHITE,
        fontStyle: 'bold',
        fontSize: 9,
      },
      showFoot: 'lastPage',
      // columnStyles only reach the body; keep the Amount header and total aligned with the figures.
      didParseCell: (data) => {
        if (data.section !== 'body' && data.column.index === 2) {
          data.cell.styles.halign = 'right';
          data.cell.styles.cellPadding = AMOUNT_PAD;
        }
      },
    });

    this.drawPageFooter(doc, branding);
  }

  // ─── Full event report ────────────────────────────────────────────────────

  private drawFullEventReport(
    doc: jsPDF,
    report: FullEventReport,
    branding: PdfBranding,
  ): void {
    const [yr, mo, dy] = report.eventDate.split('-').map(Number);
    const eventDateFormatted = new Date(yr, mo - 1, dy).toLocaleDateString(
      'en-GB',
      { day: '2-digit', month: 'long', year: 'numeric' },
    );

    let y = this.drawPageHeader(
      doc,
      applyWording('Sunday Service Report', branding.wording),
      branding,
    );
    y = this.drawAccentBand(
      doc,
      branding.theme,
      y,
      report.eventName,
      eventDateFormatted,
    );
    y += 6;

    // ── Event-level variance overview table ──────────────────────────────
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(11)
      .setTextColor(DARK)
      .text('Session Overview', MARGIN, y);
    y += 5;

    const overviewBody = report.sessions.map((entry) => {
      const r = entry.report;
      const varMins = r.slotVarianceMinutes ?? 0;
      return [
        entry.serviceSlotName,
        r.totalAllocatedMinutes != null
          ? `${r.totalAllocatedMinutes} min`
          : '—',
        r.totalDurationMinutes != null ? `${r.totalDurationMinutes} min` : '—',
        `${Math.round(r.totalPauseDurationSeconds / 60)} min`,
        this.fmtVariance(varMins),
        `${r.completionRate}%`,
      ];
    });

    const s = report.summary;
    const overviewFoot = s
      ? [
          [
            'Total / Avg',
            `${s.totalAllocatedMinutes} min`,
            s.totalDurationMinutes != null
              ? `${s.totalDurationMinutes} min`
              : '—',
            `${s.totalPauseMinutes} min`,
            this.fmtVariance(s.totalSlotVarianceMinutes),
            `${s.avgCompletionRate}%`,
          ],
        ]
      : undefined;

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [
        [
          applyWording('Service', branding.wording),
          'Allocated',
          'Duration',
          'Pauses',
          'Slot Var.',
          'Cmpl.',
        ],
      ],
      body: overviewBody,
      foot: overviewFoot,
      columnStyles: {
        0: { cellWidth: 46 },
        1: { cellWidth: 24 },
        2: { cellWidth: 26 },
        3: { cellWidth: 22 },
        4: { cellWidth: 28 },
        5: { cellWidth: 28 },
      },
      headStyles: {
        fillColor: branding.theme.accent,
        textColor: DARK,
        fontStyle: 'bold',
        fontSize: 9,
      },
      bodyStyles: { fontSize: 9, textColor: DARK, fillColor: WHITE },
      alternateRowStyles: { fillColor: branding.theme.soft },
      footStyles: {
        fillColor: branding.theme.brand,
        textColor: WHITE,
        fontStyle: 'bold',
        fontSize: 9,
      },
      showFoot: 'lastPage',
      didParseCell: (data) => {
        if (data.column.index === 4 && data.section === 'body') {
          const raw = typeof data.cell.raw === 'string' ? data.cell.raw : '';
          if (raw.startsWith('+')) data.cell.styles.textColor = DANGER;
          else if (raw.startsWith('-')) data.cell.styles.textColor = SUCCESS;
        }
      },
    });

    y = (doc as any).lastAutoTable.finalY + 10;

    // ── Per-session sections ──────────────────────────────────────────────
    for (const entry of report.sessions) {
      const slotTime = `${this.fmtTime(entry.slotStartTime, branding.timezone)} – ${this.fmtTime(entry.slotEndTime, branding.timezone)}`;
      const r = entry.report;

      if (y > 220) {
        doc.addPage();
        y = MARGIN;
      }

      y = this.drawSectionDivider(
        doc,
        branding.theme,
        y,
        entry.serviceSlotName,
        slotTime,
      );
      y = this.drawLabelValueGrid(doc, y + 4, [
        ['Session Code', r.sessionCode],
        [
          'Duration',
          r.totalDurationMinutes == null
            ? '—'
            : `${r.totalDurationMinutes} min`,
        ],
        [
          'Allocated',
          r.totalAllocatedMinutes != null
            ? `${r.totalAllocatedMinutes} min`
            : '—',
        ],
        ['Slot Variance', this.fmtVariance(r.slotVarianceMinutes ?? 0)],
        ['Slots Completed', `${r.completedSlots} / ${r.totalSlots}`],
        ['Completion Rate', `${r.completionRate}%`],
        ['Pauses', `${r.pauseCount}`],
        [
          'Total Pause Time',
          `${Math.round(r.totalPauseDurationSeconds / 60)} min`,
        ],
      ]);

      y += 4;
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        head: [
          ['#', 'Topic', 'Speaker', 'Time', 'Allocated', 'Actual', 'Overrun'],
        ],
        body: r.slots.map((slot) => {
          let overrun = '—';
          if (slot.overrunSeconds != null) {
            const mins = Math.round(slot.overrunSeconds / 60);
            overrun = mins > 0 ? `+${mins} min` : `${mins} min`;
          }
          return [
            String(slot.position + 1),
            this.slotTopicLabel(slot),
            slot.speakerName ?? '—',
            this.fmtSlotTimeRange(slot, branding.timezone),
            slot.allocatedMinutes == null
              ? '—'
              : `${slot.allocatedMinutes} min`,
            slot.actualSeconds == null
              ? '—'
              : `${Math.round(slot.actualSeconds / 60)} min`,
            overrun,
          ];
        }),
        columnStyles: {
          0: { cellWidth: 8 },
          1: { cellWidth: 40 },
          2: { cellWidth: 30 },
          3: { cellWidth: 32 },
          4: { cellWidth: 18 },
          5: { cellWidth: 18 },
          6: { cellWidth: 28 },
        },
        headStyles: {
          fillColor: branding.theme.accent,
          textColor: DARK,
          fontStyle: 'bold',
          fontSize: 9,
        },
        bodyStyles: { fontSize: 9, textColor: DARK, fillColor: WHITE },
        alternateRowStyles: { fillColor: branding.theme.soft },
        didParseCell: (data) => {
          if (
            data.section === 'body' &&
            data.column.index === 6 &&
            typeof data.cell.raw === 'string' &&
            data.cell.raw.startsWith('+')
          ) {
            data.cell.styles.textColor = DANGER;
          }
          const rowSlot = r.slots[data.row.index];
          if (
            data.section === 'body' &&
            rowSlot?.status === ServiceSessionSlotStatusEnum.SKIPPED
          ) {
            data.cell.styles.textColor = MUTED;
          }
        },
      });

      y = (doc as any).lastAutoTable.finalY + 4;

      if (r.pauses.length > 0) {
        doc
          .setFont('helvetica', 'bold')
          .setFontSize(9)
          .setTextColor(DARK)
          .text('Pauses', MARGIN, y + 4);
        autoTable(doc, {
          startY: y + 8,
          margin: { left: MARGIN, right: MARGIN },
          head: [['Slot', 'Reason', 'Duration']],
          body: r.pauses.map((p) => [
            this.pauseSlotLabel(p.slotPosition, r.slots),
            p.reason.replaceAll('_', ' '),
            p.durationSeconds == null
              ? 'ongoing'
              : `${Math.round(p.durationSeconds / 60)} min`,
          ]),
          headStyles: {
            fillColor: branding.theme.accent,
            textColor: DARK,
            fontStyle: 'bold',
            fontSize: 9,
          },
          bodyStyles: { fontSize: 9, textColor: MUTED, fillColor: WHITE },
          alternateRowStyles: { fillColor: branding.theme.soft },
        });
        y = (doc as any).lastAutoTable.finalY + 4;
      }

      const bandY =
        y + 14 > 277
          ? (() => {
              doc.addPage();
              return MARGIN;
            })()
          : y;
      y = this.drawTimeSummaryBand(doc, branding.theme, bandY, r) + 8;
    }

    this.drawPageFooter(doc, branding);
  }

  // ─── Event summary report ─────────────────────────────────────────────────

  private drawEventSummaryReport(
    doc: jsPDF,
    report: FullEventReport,
    branding: PdfBranding,
  ): void {
    const [yr, mo, dy] = report.eventDate.split('-').map(Number);
    const eventDateFormatted = new Date(yr, mo - 1, dy).toLocaleDateString(
      'en-GB',
      { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' },
    );

    doc.setFillColor(branding.theme.brand);
    doc.rect(0, 0, PAGE_W, 22, 'F');
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(9)
      .setTextColor(WHITE)
      .text(branding.churchName, MARGIN, 10);
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(8)
      .setTextColor(branding.theme.accent)
      .text(branding.churchTagline, PAGE_W - MARGIN, 10, { align: 'right' });

    doc
      .setFont('helvetica', 'bold')
      .setFontSize(16)
      .setTextColor(DARK)
      .text(report.eventName.toUpperCase(), PAGE_W / 2, 40, {
        align: 'center',
      });
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(8.5)
      .setTextColor(MUTED)
      .text(`Event Report  ·  ${eventDateFormatted}`, PAGE_W / 2, 49, {
        align: 'center',
      });
    const generatedAt = new Date().toLocaleString('en-GB', {
      timeZone: branding.timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    doc
      .setFontSize(7.5)
      .text(`Generated: ${generatedAt}`, PAGE_W / 2, 55, { align: 'center' });
    doc
      .setDrawColor(branding.theme.accent)
      .setLineWidth(0.5)
      .line(MARGIN, 59, PAGE_W - MARGIN, 59);

    let y = 65;

    const allRows: Array<{ serviceName: string; slot: SessionSlotReport }> = [];
    for (const entry of report.sessions) {
      for (const slot of entry.report.slots) {
        allRows.push({ serviceName: entry.serviceSlotName, slot });
      }
    }

    const totalSlots = allRows.length;
    const doneSlots = allRows.filter(
      ({ slot }) => slot.status === ServiceSessionSlotStatusEnum.COMPLETED,
    ).length;
    const totalAllocSec = allRows.reduce(
      (sum, { slot }) => sum + slot.allocatedMinutes * 60,
      0,
    );
    const totalActualSec = allRows.reduce(
      (sum, { slot }) => sum + (slot.actualSeconds ?? 0),
      0,
    );
    const varSec = totalAllocSec - totalActualSec;

    const cardW = (CONTENT_W - 6) / 4;
    const cardH = 22;
    const cards: Array<{ label: string; value: string; color: string }> = [
      {
        label: 'SPEAKERS DONE',
        value: `${doneSlots} / ${totalSlots}`,
        color: DARK,
      },
      {
        label: 'TOTAL ALLOCATED',
        value: this.fmtSecsMM(totalAllocSec),
        color: DARK,
      },
      {
        label: 'TOTAL ACTUAL',
        value: totalActualSec > 0 ? this.fmtSecsMM(totalActualSec) : '—',
        color: DARK,
      },
      {
        label: 'OVERALL VARIANCE',
        value: totalActualSec > 0 ? this.fmtSecsMM(Math.abs(varSec)) : '—',
        color: totalActualSec > 0 ? (varSec >= 0 ? SUCCESS : DANGER) : DARK,
      },
    ];

    cards.forEach(({ label, value, color }, i) => {
      const x = MARGIN + i * (cardW + 2);
      doc.setFillColor(branding.theme.accent);
      doc.roundedRect(x, y, cardW, cardH, 2, 2, 'F');
      doc
        .setFont('helvetica', 'normal')
        .setFontSize(6.5)
        .setTextColor(MUTED)
        .text(label, x + cardW / 2, y + 7, { align: 'center' });
      doc
        .setFont('helvetica', 'bold')
        .setFontSize(11)
        .setTextColor(color)
        .text(value, x + cardW / 2, y + 16, { align: 'center' });
    });

    y += cardH + 8;

    const tableBody = allRows.map(({ serviceName, slot }, idx) => {
      const speaker = slot.speakerName ?? '—';
      const topicSlot = `${serviceName}: ${this.slotTopicLabel(slot)}`;
      const allocated = `${String(slot.allocatedMinutes).padStart(2, '0')}:00`;
      const actual =
        slot.actualSeconds != null ? this.fmtSecsMM(slot.actualSeconds) : '—';
      const variance =
        slot.overrunSeconds != null
          ? this.fmtOverrunMM(slot.overrunSeconds)
          : '—';
      const status = this.slotStatusLabel(slot.status, slot.overrunSeconds);
      return [
        String(idx + 1),
        speaker,
        topicSlot,
        allocated,
        actual,
        variance,
        status,
      ];
    });

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [
        [
          '#',
          'Speaker',
          'Topic / Slot',
          'Allocated',
          'Actual',
          'Variance',
          'Status',
        ],
      ],
      body: tableBody,
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 34 },
        2: { cellWidth: 54 },
        3: { cellWidth: 20, halign: 'right' },
        4: { cellWidth: 20, halign: 'right' },
        5: { cellWidth: 16, halign: 'right' },
        6: { cellWidth: 18 },
      },
      headStyles: {
        fillColor: branding.theme.accent,
        textColor: DARK,
        fontStyle: 'bold',
        fontSize: 8.5,
      },
      bodyStyles: { fontSize: 8.5, textColor: DARK, fillColor: WHITE },
      alternateRowStyles: { fillColor: branding.theme.soft },
      didParseCell: (data) => {
        if (data.section !== 'body') return;
        const row = allRows[data.row.index];
        if (!row) return;
        if (data.column.index === 5) {
          const v = typeof data.cell.raw === 'string' ? data.cell.raw : '';
          if (v.startsWith('+')) data.cell.styles.textColor = DANGER;
          else if (v.startsWith('-')) data.cell.styles.textColor = SUCCESS;
        }
        if (data.column.index === 6) {
          const v = typeof data.cell.raw === 'string' ? data.cell.raw : '';
          if (v === 'Over Time') data.cell.styles.textColor = DANGER;
          else if (v === 'Under Time' || v === 'On Time')
            data.cell.styles.textColor = SUCCESS;
          else if (v === 'Not Used' || v === 'Pending')
            data.cell.styles.textColor = MUTED;
        }
      },
    });

    this.drawPageFooter(doc, branding);
  }

  private fmtSecsMM(seconds: number): string {
    const abs = Math.abs(Math.round(seconds));
    return `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
  }

  private fmtOverrunMM(overrunSeconds: number): string {
    if (overrunSeconds === 0) return '0:00';
    const str = this.fmtSecsMM(Math.abs(overrunSeconds));
    return overrunSeconds > 0 ? `+${str}` : `-${str}`;
  }

  private slotStatusLabel(
    status: string,
    overrunSeconds: number | null,
  ): string {
    if (status === ServiceSessionSlotStatusEnum.SKIPPED) return 'Not Used';
    if (status === ServiceSessionSlotStatusEnum.IN_PROGRESS) return 'Active';
    if (status === ServiceSessionSlotStatusEnum.PENDING) return 'Pending';
    if (status === ServiceSessionSlotStatusEnum.COMPLETED) {
      if (overrunSeconds == null) return 'Done';
      if (overrunSeconds > 30) return 'Over Time';
      if (overrunSeconds < -30) return 'Under Time';
      return 'On Time';
    }
    return status;
  }

  // Human-readable fallback for a slot's type (e.g. "Praise & Worship",
  // "Offering") — used whenever a slot has no topic set, so rows without a
  // topic are still individually identifiable rather than all showing "—".
  private slotTypeLabel(type: string): string {
    return (
      ServiceSlotTypeLabels[type as keyof typeof ServiceSlotTypeLabels] ?? type
    );
  }

  private slotTopicLabel(slot: SessionSlotReport): string {
    return slot.topic || this.slotTypeLabel(slot.type);
  }

  // Pause entries only store the slot's bare position (see ServicePauseEntry),
  // so the Pause Log table needs to resolve that back to the slot's own
  // topic/type label — otherwise it reads as an unexplained "Slot 3".
  private pauseSlotLabel(
    slotPosition: number,
    slots: SessionSlotReport[],
  ): string {
    const slot = slots.find((s) => s.position === slotPosition);
    return slot ? this.slotTopicLabel(slot) : `Slot ${slotPosition + 1}`;
  }

  // ─── Programme draft ─────────────────────────────────────────────────────

  private drawProgrammeDraft(
    doc: jsPDF,
    programme: ServiceProgramme,
    branding: PdfBranding,
  ): void {
    const slot = programme.serviceSlot;
    const event = slot?.event;
    const dateLabel = event?.eventDate
      ? new Date(event.eventDate).toLocaleDateString('en-GB', {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })
      : '—';
    const sorted = [...(programme.slots ?? [])].sort(
      (a, b) => a.position - b.position,
    );

    const y = this.drawOrderOfServiceHeader(
      doc,
      slot?.name ?? applyWording('Service Programme', branding.wording),
      dateLabel,
      branding,
    );
    this.drawOrderOfServiceTable(
      doc,
      branding.theme,
      y,
      slot?.name ?? applyWording('Service', branding.wording),
      slot?.startTime ?? null,
      sorted,
      branding.timezone,
    );
    this.drawPageFooter(doc, branding);
  }

  // ─── Full event programme ────────────────────────────────────────────────

  private drawEventProgramme(
    doc: jsPDF,
    event: ChurchEvent,
    sections: Array<{ slot: ServiceSlot; programme: ServiceProgramme | null }>,
    branding: PdfBranding,
  ): void {
    const dateLabel = event.eventDate
      ? new Date(event.eventDate).toLocaleDateString('en-GB', {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })
      : '—';

    let y = this.drawOrderOfServiceHeader(doc, event.name, dateLabel, branding);

    for (const { slot, programme } of sections) {
      if (y > 230) {
        doc.addPage();
        y = MARGIN;
      }

      if (!programme) {
        y = this.drawNoProgammePlaceholder(
          doc,
          branding.theme,
          y,
          slot,
          branding.timezone,
        );
        continue;
      }

      const sorted = [...(programme.slots ?? [])].sort(
        (a, b) => a.position - b.position,
      );
      y = this.drawOrderOfServiceTable(
        doc,
        branding.theme,
        y,
        slot.name,
        slot.startTime ?? null,
        sorted,
        branding.timezone,
      );
      y += 6;
    }

    this.drawPageFooter(doc, branding);
  }

  // ─── Shared order-of-service helpers ─────────────────────────────────────

  private drawOrderOfServiceHeader(
    doc: jsPDF,
    title: string,
    dateLabel: string,
    branding: PdfBranding,
  ): number {
    doc.setFillColor(branding.theme.brand);
    doc.rect(0, 0, PAGE_W, 22, 'F');
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(9)
      .setTextColor(WHITE)
      .text(branding.churchName, MARGIN, 10);
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(8)
      .setTextColor(branding.theme.accent)
      .text(branding.churchTagline, PAGE_W - MARGIN, 10, { align: 'right' });

    doc
      .setFont('helvetica', 'bold')
      .setFontSize(18)
      .setTextColor(DARK)
      .text(title.toUpperCase(), PAGE_W / 2, 40, { align: 'center' });
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(10)
      .setTextColor(MUTED)
      .text(dateLabel, PAGE_W / 2, 48, { align: 'center' });
    doc
      .setDrawColor(branding.theme.accent)
      .setLineWidth(0.5)
      .line(MARGIN, 52, PAGE_W - MARGIN, 52);
    return 58;
  }

  private drawOrderOfServiceTable(
    doc: jsPDF,
    theme: ChurchThemeColors,
    y: number,
    serviceName: string,
    serviceStart: Date | null,
    slots: ServiceProgrammeSlot[],
    timeZone: string,
  ): number {
    const hasBackup = slots.some(
      (s) => s.backupMember || s.backupGuestName || s.backupDepartment,
    );

    const COL = hasBackup
      ? {
          sn: 10,
          events: 48,
          start: 24,
          dur: 20,
          end: 24,
          minister: 26,
          backup: 22,
        }
      : {
          sn: 10,
          events: 58,
          start: 26,
          dur: 22,
          end: 26,
          minister: 32,
          backup: 0,
        };

    const colCount = hasBackup ? 7 : 6;

    const rows: any[] = [];
    let cursor = serviceStart ? new Date(serviceStart) : null;
    let totalMinutes = 0;

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const mins = s.allocatedMinutes ?? 0;
      const rowStart = cursor ? this.fmtTime(cursor, timeZone) : '—';
      const rowEnd = cursor
        ? this.fmtTime(new Date(cursor.getTime() + mins * 60_000), timeZone)
        : '—';
      if (cursor) cursor = new Date(cursor.getTime() + mins * 60_000);
      totalMinutes += mins;

      let minister = '—';
      if (s.member)
        minister = `${this.cap(s.member.firstname)} ${this.cap(s.member.lastname)}`;
      else if (s.guestName) minister = s.guestName;
      else if (s.department) minister = s.department.name;

      const row: any[] = [
        String(i + 1),
        s.topic || this.slotTypeLabel(s.type),
        rowStart,
        this.fmtDuration(mins),
        rowEnd,
        minister,
      ];

      if (hasBackup) {
        let backup = '—';
        if (s.backupMember)
          backup = `${this.cap(s.backupMember.firstname)} ${this.cap(s.backupMember.lastname)}`;
        else if (s.backupGuestName) backup = s.backupGuestName;
        else if (s.backupDepartment) backup = s.backupDepartment.name;
        row.push(backup);
      }

      rows.push(row);
    }

    const totalLabel = this.fmtTotalDuration(totalMinutes);
    const finalTime = cursor ? this.fmtTime(cursor, timeZone) : '—';
    const footRow = [
      '',
      '',
      '',
      totalLabel,
      finalTime,
      '',
      ...(hasBackup ? [''] : []),
    ];

    const columnStyles: Record<number, any> = {
      0: { cellWidth: COL.sn, halign: 'center' },
      1: { cellWidth: COL.events },
      2: { cellWidth: COL.start, halign: 'center' },
      3: { cellWidth: COL.dur, halign: 'center' },
      4: { cellWidth: COL.end, halign: 'center' },
      5: { cellWidth: COL.minister },
    };
    if (hasBackup) columnStyles[6] = { cellWidth: COL.backup };

    const colHeaders = [
      'S/N',
      'EVENTS',
      'START TIME',
      'DURATION',
      'END TIME',
      'MINISTER',
      ...(hasBackup ? ['BACKUP'] : []),
    ];

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [
        [
          {
            content: serviceName.toUpperCase(),
            colSpan: colCount,
            styles: {
              halign: 'center',
              fillColor: theme.brand,
              textColor: WHITE,
              fontStyle: 'bold',
              fontSize: 10,
              cellPadding: 4,
            },
          },
        ],
        colHeaders,
      ],
      body: rows,
      foot: [footRow],
      columnStyles,
      headStyles: {
        fillColor: theme.accent,
        textColor: DARK,
        fontStyle: 'bold',
        fontSize: 8.5,
      },
      bodyStyles: { fontSize: 9, textColor: DARK, fillColor: WHITE },
      alternateRowStyles: { fillColor: theme.soft },
      footStyles: {
        fillColor: theme.brand,
        textColor: WHITE,
        fontStyle: 'bold',
        fontSize: 9,
      },
      showFoot: 'lastPage',
    });

    return (doc as any).lastAutoTable.finalY;
  }

  private drawNoProgammePlaceholder(
    doc: jsPDF,
    theme: ChurchThemeColors,
    y: number,
    slot: ServiceSlot,
    timeZone: string,
  ): number {
    const timeLabel =
      slot.startTime && slot.endTime
        ? `${this.fmtTime(slot.startTime, timeZone)} – ${this.fmtTime(slot.endTime, timeZone)}`
        : '';

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [
        [
          {
            content: slot.name.toUpperCase(),
            colSpan: 6,
            styles: {
              halign: 'center',
              fillColor: theme.brand,
              textColor: WHITE,
              fontStyle: 'bold',
              fontSize: 10,
              cellPadding: 4,
            },
          },
        ],
      ],
      body: [
        [
          {
            content: `${timeLabel ? timeLabel + ' · ' : ''}No programme has been created for this service.`,
            colSpan: 6,
            styles: {
              halign: 'center',
              textColor: MUTED,
              fontStyle: 'italic',
              fontSize: 9,
              cellPadding: 6,
            },
          },
        ],
      ],
      headStyles: { fillColor: theme.brand, textColor: WHITE },
      bodyStyles: { fillColor: WHITE },
    });

    return (doc as any).lastAutoTable.finalY + 6;
  }

  private fmtDuration(minutes: number): string {
    return `${String(minutes).padStart(2, '0')}:00`;
  }

  private fmtTotalDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  }

  private drawSectionDivider(
    doc: jsPDF,
    theme: ChurchThemeColors,
    y: number,
    title: string,
    subtitle: string,
  ): number {
    doc.setFillColor(theme.brand);
    doc.rect(MARGIN, y, CONTENT_W, 9, 'F');
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(9)
      .setTextColor(WHITE)
      .text(title, MARGIN + 4, y + 6);
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(8)
      .setTextColor(theme.accent)
      .text(subtitle, PAGE_W - MARGIN - 4, y + 6, { align: 'right' });
    return y + 9;
  }

  // ─── Shared layout helpers ────────────────────────────────────────────────

  private drawPageHeader(
    doc: jsPDF,
    title: string,
    branding: PdfBranding,
  ): number {
    doc.setFillColor(branding.theme.brand);
    doc.rect(0, 0, PAGE_W, 22, 'F');

    // Logo shifts the church name/tagline right to make room — wrapped in
    // its own try/catch since a corrupt or unexpectedly-encoded image
    // should degrade to the text-only header this already was, not fail
    // the whole PDF.
    let textStartX = MARGIN;
    if (branding.logoImage) {
      try {
        doc.addImage(
          branding.logoImage.dataUrl,
          branding.logoImage.format,
          MARGIN,
          3,
          16,
          16,
          undefined,
          'FAST',
        );
        textStartX = MARGIN + 20;
      } catch {
        textStartX = MARGIN;
      }
    }

    doc
      .setFont('helvetica', 'bold')
      .setFontSize(9)
      .setTextColor(WHITE)
      .text(branding.churchName, textStartX, 10);

    doc
      .setFont('helvetica', 'normal')
      .setFontSize(8)
      .setTextColor(branding.theme.accent)
      .text(branding.churchTagline, PAGE_W - MARGIN, 10, { align: 'right' });

    doc
      .setFont('helvetica', 'bold')
      .setFontSize(15)
      .setTextColor(DARK)
      .text(title, MARGIN, 36);

    doc
      .setDrawColor(branding.theme.accent)
      .setLineWidth(0.6)
      .line(MARGIN, 40, PAGE_W - MARGIN, 40);

    return 48;
  }

  private drawAccentBand(
    doc: jsPDF,
    theme: ChurchThemeColors,
    y: number,
    primary: string,
    secondary: string,
    rightLabel?: string,
    rightValue?: string,
  ): number {
    const h = 14;
    doc.setFillColor(theme.accent);
    doc.roundedRect(MARGIN, y, CONTENT_W, h, 2, 2, 'F');

    doc
      .setFont('helvetica', 'bold')
      .setFontSize(10)
      .setTextColor(DARK)
      .text(primary, MARGIN + 5, y + 5.5);
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(8.5)
      .setTextColor(MUTED)
      .text(secondary, MARGIN + 5, y + 10.5);

    if (rightLabel && rightValue) {
      const rightX = PAGE_W - MARGIN - 5;
      doc
        .setFont('helvetica', 'normal')
        .setFontSize(7.5)
        .setTextColor(MUTED)
        .text(rightLabel, rightX, y + 5.5, { align: 'right' });
      doc
        .setFont('helvetica', 'bold')
        .setFontSize(9)
        .setTextColor(DARK)
        .text(rightValue, rightX, y + 10.5, { align: 'right' });
    }

    return y + h;
  }

  private drawLabelValueGrid(
    doc: jsPDF,
    y: number,
    pairs: [string, string][],
  ): number {
    const colW = CONTENT_W / 2;
    pairs.forEach(([label, value], i) => {
      const col = i % 2 === 0 ? MARGIN : MARGIN + colW;
      const row = y + Math.floor(i / 2) * 8;
      doc
        .setFont('helvetica', 'normal')
        .setFontSize(8)
        .setTextColor(MUTED)
        .text(label, col, row);
      doc
        .setFont('helvetica', 'bold')
        .setFontSize(9)
        .setTextColor(DARK)
        .text(value, col, row + 4);
    });
    return y + Math.ceil(pairs.length / 2) * 8 + 2;
  }

  private fmtVariance(minutes: number): string {
    if (minutes > 0) return `+${minutes} min`;
    if (minutes < 0) return `${minutes} min`;
    return 'On time';
  }

  private drawAnalysisSection(
    doc: jsPDF,
    y: number,
    report: SessionReport,
  ): number {
    const lines = this.buildSessionAnalysisLines(report);
    if (lines.length === 0) return y;

    let cursorY = y;
    if (cursorY + 6 + lines.length * 9 > 270) {
      doc.addPage();
      cursorY = MARGIN;
    }

    doc
      .setFont('helvetica', 'bold')
      .setFontSize(11)
      .setTextColor(DARK)
      .text('Analysis', MARGIN, cursorY);
    cursorY += 6;

    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(DARK);
    for (const line of lines) {
      const wrapped = doc.splitTextToSize(`•  ${line}`, CONTENT_W);
      doc.text(wrapped, MARGIN, cursorY);
      cursorY += wrapped.length * 4.5 + 2;
    }

    return cursorY + 4;
  }

  // Derived, presentation-only insights from data already on SessionReport —
  // deliberately not part of the JSON report contract, since these are
  // narrative summaries for the printed page, not additional API fields.
  private buildSessionAnalysisLines(report: SessionReport): string[] {
    const completed = report.slots.filter(
      (s) => s.status === ServiceSessionSlotStatusEnum.COMPLETED,
    );
    const skippedCount = report.slots.filter(
      (s) => s.status === ServiceSessionSlotStatusEnum.SKIPPED,
    ).length;

    return [
      this.buildTimingAdherenceLine(completed, report.slotVarianceMinutes),
      this.buildSkippedSlotsLine(skippedCount),
      this.buildWorstOverrunLine(completed),
      this.buildPauseSummaryLine(report),
    ].filter((line): line is string => line != null);
  }

  private buildTimingAdherenceLine(
    completed: SessionSlotReport[],
    slotVarianceMinutes: number | null,
  ): string | null {
    if (completed.length === 0) return null;

    const overCount = completed.filter(
      (s) => (s.overrunSeconds ?? 0) > 30,
    ).length;
    const underCount = completed.filter(
      (s) => (s.overrunSeconds ?? 0) < -30,
    ).length;
    const onTimeCount = completed.length - overCount - underCount;
    const detail =
      overCount > 0 || underCount > 0
        ? ` (${overCount} ran over, ${underCount} finished early), for a combined variance of ${this.fmtVariance(slotVarianceMinutes ?? 0)}.`
        : '.';
    return `${onTimeCount} of ${completed.length} completed slots finished within their allocated time${detail}`;
  }

  private buildSkippedSlotsLine(skippedCount: number): string | null {
    if (skippedCount === 0) return null;
    const plural = skippedCount === 1 ? '' : 's';
    const verb = skippedCount === 1 ? 'was' : 'were';
    return `${skippedCount} slot${plural} never started and ${verb} marked skipped when the session ended.`;
  }

  private buildWorstOverrunLine(completed: SessionSlotReport[]): string | null {
    const worstOverrun = [...completed]
      .filter((s) => (s.overrunSeconds ?? 0) > 0)
      .sort((a, b) => (b.overrunSeconds ?? 0) - (a.overrunSeconds ?? 0))[0];
    if (!worstOverrun) return null;

    const mins = Math.round((worstOverrun.overrunSeconds ?? 0) / 60);
    return `Biggest overrun: "${worstOverrun.topic ?? worstOverrun.type}" ran ${mins} min over its allocation.`;
  }

  private buildPauseSummaryLine(report: SessionReport): string | null {
    if (report.pauseCount === 0) return null;

    const reasonCounts = new Map<string, number>();
    for (const p of report.pauses) {
      reasonCounts.set(p.reason, (reasonCounts.get(p.reason) ?? 0) + 1);
    }
    const topReason = [...reasonCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0];
    const pauseMins = Math.round(report.totalPauseDurationSeconds / 60);
    const reasonSuffix = topReason
      ? `, most often for ${topReason.replaceAll('_', ' ').toLowerCase()}.`
      : '.';
    return `Paused ${report.pauseCount} time${report.pauseCount === 1 ? '' : 's'} for a total of ${pauseMins} min${reasonSuffix}`;
  }

  private drawTimeSummaryBand(
    doc: jsPDF,
    theme: ChurchThemeColors,
    y: number,
    report: SessionReport,
  ): number {
    const h = 14;
    doc.setFillColor(theme.accent);
    doc.roundedRect(MARGIN, y, CONTENT_W, h, 2, 2, 'F');

    const colW = CONTENT_W / 4;
    const varMins = report.slotVarianceMinutes ?? 0;
    const allocatedValue =
      report.totalAllocatedMinutes === null ||
      report.totalAllocatedMinutes === undefined
        ? '—'
        : `${report.totalAllocatedMinutes} min`;
    const durationValue =
      report.totalDurationMinutes === null ||
      report.totalDurationMinutes === undefined
        ? '—'
        : `${report.totalDurationMinutes} min`;
    let varColor: string;
    if (varMins > 0) varColor = DANGER;
    else if (varMins < 0) varColor = SUCCESS;
    else varColor = DARK;
    const cells: Array<{ label: string; value: string; color: string }> = [
      { label: 'Allocated', value: allocatedValue, color: DARK },
      {
        label: 'Slot Variance',
        value: this.fmtVariance(varMins),
        color: varColor,
      },
      { label: 'Duration', value: durationValue, color: DARK },
      {
        label: 'Pauses',
        value: `${Math.round(report.totalPauseDurationSeconds / 60)} min`,
        color: DARK,
      },
    ];

    cells.forEach(({ label, value, color }, i) => {
      const x = MARGIN + i * colW + colW / 2;
      doc
        .setFont('helvetica', 'normal')
        .setFontSize(7.5)
        .setTextColor(MUTED)
        .text(label, x, y + 4.5, { align: 'center' });
      doc
        .setFont('helvetica', 'bold')
        .setFontSize(9.5)
        .setTextColor(color)
        .text(value, x, y + 10.5, { align: 'center' });
    });

    return y + h;
  }

  private drawPageFooter(doc: jsPDF, branding: PdfBranding): void {
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      const pageH = 297;
      doc
        .setDrawColor(branding.theme.accent)
        .setLineWidth(0.4)
        .line(MARGIN, pageH - 16, PAGE_W - MARGIN, pageH - 16);
      doc
        .setFont('helvetica', 'normal')
        .setFontSize(7.5)
        .setTextColor(MUTED)
        .text(
          `${branding.churchName} · ${branding.churchAddress}`,
          MARGIN,
          pageH - 10,
        );
      doc.text(`Page ${i} of ${pageCount}`, PAGE_W - MARGIN, pageH - 10, {
        align: 'right',
      });
    }
  }

  private fmtDate(date: Date, timeZone: string): string {
    return new Date(date).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone,
    });
  }

  private fmtTime(date: Date, timeZone: string): string {
    return new Date(date).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone,
    });
  }

  private fmtSlotTimeRange(slot: SessionSlotReport, timeZone: string): string {
    if (!slot.startedAt) return '—';
    const start = this.fmtTime(slot.startedAt, timeZone);
    if (!slot.completedAt) return `${start} –`;
    return `${start} – ${this.fmtTime(slot.completedAt, timeZone)}`;
  }

  private fmtMonthShort(ym: string): string {
    const [year, month] = ym.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString('en-GB', {
      month: 'short',
      year: 'numeric',
    });
  }

  private cap(str: string): string {
    return str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '';
  }

  // ─── Department goal report ──────────────────────────────────────────────

  private drawDepartmentGoalReport(
    doc: jsPDF,
    report: DepartmentGoalPdfReport,
    branding: PdfBranding,
  ): void {
    let y = this.drawPageHeader(
      doc,
      applyWording('Department Goals', branding.wording),
      branding,
    );
    y = this.drawAccentBand(
      doc,
      branding.theme,
      y,
      report.departmentName,
      report.cycleName,
      'Stage',
      this.cap(report.stage),
    );
    y += 4;

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [
        [
          'Goal',
          'Self Rating',
          applyWording('Church Rating', branding.wording),
        ],
      ],
      body: report.goals.map((g) => [
        [
          g.title,
          g.description,
          g.timelineToAchieve ? `Timeline: ${g.timelineToAchieve}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        g.selfRating !== null
          ? `${g.selfRating}/5${g.selfRatingReason ? ` — ${g.selfRatingReason}` : ''}`
          : '—',
        g.churchRating !== null
          ? `${g.churchRating}/5${g.churchRatingReason ? ` — ${g.churchRatingReason}` : ''}`
          : '—',
      ]),
      columnStyles: {
        0: { cellWidth: CONTENT_W * 0.5 },
        1: { cellWidth: CONTENT_W * 0.25 },
        2: { cellWidth: CONTENT_W * 0.25 },
      },
      headStyles: {
        fillColor: branding.theme.accent,
        textColor: DARK,
        fontStyle: 'bold',
        fontSize: 9,
      },
      bodyStyles: { fontSize: 8.5, textColor: DARK, fillColor: WHITE },
      alternateRowStyles: { fillColor: branding.theme.soft },
    });
  }

  private drawFollowUpMonthlyReport(
    doc: jsPDF,
    r: FollowUpMonthlyReport,
    branding: PdfBranding,
  ): void {
    const theme = branding.theme;
    const monthName = (m: string) =>
      new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
    const day = (d: string, weekday = true) =>
      new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
        ...(weekday && { weekday: 'short' }),
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      });
    const pctOf = (n: number, of: number) =>
      of ? `${Math.round((n / of) * 100)}%` : '—';

    let y = this.drawReportCover(
      doc,
      branding,
      'Follow-Up Monthly Report',
      monthName(r.month),
    );

    const t = r.totals;
    const change = r.change;
    y = this.drawStatCards(doc, y, theme, [
      {
        value: String(t.firstTimers),
        label: 'First-timers',
        note:
          change === null
            ? undefined
            : `${change >= 0 ? '+' : ''}${change}% on ${monthName(r.recap.month).split(' ')[0]}`,
        tone: change === null ? undefined : change >= 0 ? 'good' : 'watch',
      },
      {
        value: String(t.wantsToJoinChurch),
        label: applyWording('Want to join the church', branding.wording),
        note: t.firstTimers
          ? `${pctOf(t.wantsToJoinChurch, t.firstTimers)} of first-timers`
          : undefined,
      },
      {
        value: String(t.wantsToJoinWorkforce),
        label: 'Want to join the workforce',
        note: t.firstTimers
          ? `${pctOf(t.wantsToJoinWorkforce, t.firstTimers)} of first-timers`
          : undefined,
      },
      r.strongestDay
        ? {
            value: String(r.strongestDay.count),
            label: 'Busiest day',
            note: day(r.strongestDay.date),
          }
        : { value: '—', label: 'Busiest day' },
    ]);

    if (!t.firstTimers)
      y = this.drawAccountNote(
        doc,
        y + 8,
        `No first-timers were recorded for ${monthName(r.month)}. If cards are still being typed in, set each one's date of visit so it counts in the right month.`,
      );
    y = this.drawHighlightBoxes(doc, y + 6, r.highlights);

    const recap = r.recap;
    y = this.sectionStart(
      doc,
      y + 10,
      `Last month's first-timers: ${monthName(recap.month)}`,
      4,
    );
    if (!recap.wantedToJoin) {
      y = this.drawAccountNote(
        doc,
        y,
        `${recap.firstTimers} first-timers; none asked to join.`,
      );
    } else {
      y = this.drawAccountNote(
        doc,
        y,
        `${recap.firstTimers} first-timers, ${recap.wantedToJoin} of whom wanted to join. Where those ${recap.wantedToJoin} are now:`,
      );
      const toneOf = (o: string): StatTone =>
        o === 'STILL_ATTENDING' || o === 'JOINED'
          ? 'good'
          : o === 'TEMPORARILY_AWAY' || o === 'NO_ANSWER'
            ? 'watch'
            : o === 'DECLINED'
              ? 'bad'
              : undefined;
      y = this.drawStatCards(doc, y + 1, theme, [
        ...recap.outcomes.map((o) => ({
          value: String(o.count),
          label: o.label,
          note: pctOf(o.count, recap.wantedToJoin),
          tone: toneOf(o.outcome),
        })),
        ...(recap.unreachable
          ? [
              {
                value: String(recap.unreachable),
                label: 'Unreachable',
                note: pctOf(recap.unreachable, recap.wantedToJoin),
                tone: 'bad' as StatTone,
              },
            ]
          : []),
        ...(recap.notYetReached
          ? [
              {
                value: String(recap.notYetReached),
                label: 'Not yet followed up',
                note: pctOf(recap.notYetReached, recap.wantedToJoin),
                tone: 'bad' as StatTone,
              },
            ]
          : []),
      ]);
    }

    if (r.byDate.length > 1) {
      y = this.sectionStart(doc, y + 10, 'First-timers by day', 8);
      y = this.drawDayChart(
        doc,
        y + 2,
        theme,
        r.byDate,
        r.strongestDay?.date,
        (d) => day(d, false),
      );
    }

    if (r.services.length) {
      y = this.sectionStart(doc, y + 10, 'By service', r.services.length);
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        head: [['Date', 'Service', 'First-timers', 'Attended to by']],
        body: r.services.map((s) => [
          day(s.date),
          s.eventName ?? '—',
          String(s.count),
          s.attendedBy.join(', ') || '—',
        ]),
        columnStyles: {
          2: { halign: 'right', cellWidth: 24, fontStyle: 'bold' },
        },
        headStyles: {
          fillColor: theme.brand,
          textColor: WHITE,
          fontStyle: 'bold',
          fontSize: 8.5,
        },
        bodyStyles: { fontSize: 8.5, textColor: DARK, fillColor: WHITE },
        alternateRowStyles: { fillColor: theme.tint },
      });
      y = this.tableEnd(doc);
    }

    const charts: [string, [string, number][]][] = [
      ...(r.bySource.length
        ? [
            [
              'How they were recorded',
              r.bySource.map((s): [string, number] => [s.label, s.count]),
            ] as [string, [string, number][]],
          ]
        : []),
      ...r.fields
        .filter((f) => f.counts && f.type !== 'YES_NO')
        .map((f): [string, [string, number][]] => [
          f.label,
          f.counts!.map((c): [string, number] => [c.option, c.count]),
        ]),
    ];
    for (const [title, rows] of charts) {
      y = this.sectionStart(doc, y + 10, title, rows.length);
      y = this.drawCountTable(doc, y, branding, rows);
    }

    const yesNo = r.fields.filter((f) => f.type === 'YES_NO');
    if (yesNo.length) {
      y = this.sectionStart(doc, y + 10, 'Yes or no questions', yesNo.length);
      y = this.drawCountTable(
        doc,
        y,
        branding,
        yesNo.map((f): [string, number] => [
          `${f.label} (yes)`,
          f.counts?.[0]?.count ?? 0,
        ]),
      );
    }

    if (r.liked.length) {
      y = this.sectionStart(
        doc,
        y + 10,
        'What they liked',
        Math.min(2, Math.ceil(r.liked.length / 2)),
      );
      y = this.drawQuoteCards(doc, y + 1, r.liked, theme.accent);
    }
    for (const f of r.fields.filter((f) => f.quotes?.length)) {
      y = this.sectionStart(
        doc,
        y + 10,
        f.label,
        Math.min(2, Math.ceil(f.quotes!.length / 2)),
      );
      y = this.drawQuoteCards(
        doc,
        y + 1,
        f.quotes!,
        f.key === 'improve' ? WATCH : theme.accent,
      );
    }

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc
        .setPage(i)
        .setFont('helvetica', 'normal')
        .setFontSize(7.5)
        .setTextColor(MUTED)
        .text(
          `${branding.churchName} · Follow-Up Monthly Report · ${monthName(r.month)} · Page ${i} of ${pages}`,
          PAGE_W / 2,
          290,
          { align: 'center' },
        );
    }
  }

  // A full-width band in the church's colours, with the logo, the report's name and its period.
  private drawReportCover(
    doc: jsPDF,
    branding: PdfBranding,
    title: string,
    period: string,
  ): number {
    const h = 44;
    doc.setFillColor(branding.theme.brand);
    doc.rect(0, 0, PAGE_W, h, 'F');
    let x = MARGIN;
    if (branding.logoImage) {
      try {
        doc.addImage(
          branding.logoImage.dataUrl,
          branding.logoImage.format,
          MARGIN,
          9,
          14,
          14,
          undefined,
          'FAST',
        );
        x = MARGIN + 18;
      } catch {
        x = MARGIN;
      }
    }
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(9)
      .setTextColor(WHITE)
      .text(branding.churchName, x, 14);
    if (branding.churchTagline)
      doc
        .setFont('helvetica', 'normal')
        .setFontSize(8)
        .setTextColor(branding.theme.accent)
        .text(branding.churchTagline, x, 19);
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(20)
      .setTextColor(WHITE)
      .text(title, MARGIN, 34);
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(12)
      .setTextColor(branding.theme.accent)
      .text(period, PAGE_W - MARGIN, 34, { align: 'right' });
    return h + 8;
  }

  // Horizontal cards: a big number, what it is, and an optional coloured note. Wraps after four.
  private drawStatCards(
    doc: jsPDF,
    y: number,
    theme: ChurchThemeColors,
    cards: { value: string; label: string; note?: string; tone?: StatTone }[],
  ): number {
    const perRow = 4;
    const gap = 4;
    const w = (CONTENT_W - gap * (perRow - 1)) / perRow;
    const h = 27;
    cards.forEach((c, i) => {
      const row = Math.floor(i / perRow);
      const cx = MARGIN + (i % perRow) * (w + gap);
      const cy = y + row * (h + gap);
      const tone = c.tone ? TONES[c.tone] : null;
      doc.setFillColor(tone?.fill ?? theme.tint);
      doc.roundedRect(cx, cy, w, h, 2.5, 2.5, 'F');
      doc.setFillColor(tone?.ink ?? theme.brand);
      doc.rect(cx, cy + 3, 1.2, h - 6, 'F');
      doc
        .setFont('helvetica', 'bold')
        .setFontSize(19)
        .setTextColor(tone?.ink ?? theme.brand)
        .text(c.value, cx + 5, cy + 11);
      const label = doc
        .setFont('helvetica', 'bold')
        .setFontSize(7.5)
        .splitTextToSize(c.label, w - 8);
      doc.setTextColor(DARK).text(label.slice(0, 2), cx + 5, cy + 17);
      if (c.note)
        doc
          .setFont('helvetica', 'normal')
          .setFontSize(7)
          .setTextColor(tone?.ink ?? MUTED)
          .text(c.note, cx + 5, cy + h - 3);
    });
    return y + Math.ceil(cards.length / perRow) * (h + gap) - gap;
  }

  // "Going well" and "Needs attention" side by side, the same height.
  private drawHighlightBoxes(
    doc: jsPDF,
    y: number,
    h: { good: string[]; watch: string[] },
  ): number {
    const gap = 4;
    const w = (CONTENT_W - gap) / 2;
    const boxes = [
      {
        title: 'Going well',
        items: h.good,
        tone: TONES.good,
        empty: 'Nothing stands out this month.',
      },
      {
        title: 'Needs attention',
        items: h.watch,
        tone: TONES.watch,
        empty: 'Nothing needs attention this month.',
      },
    ].map((b) => ({
      ...b,
      lines: (b.items.length ? b.items : [b.empty]).map(
        (t) =>
          doc
            .setFont('helvetica', 'normal')
            .setFontSize(8.5)
            .splitTextToSize(t, w - 14) as string[],
      ),
    }));
    const height =
      Math.max(
        ...boxes.map(
          (b) => 14 + b.lines.reduce((n, l) => n + l.length * 4 + 2, 0),
        ),
      ) + 2;
    if (y + height > 280) {
      doc.addPage();
      y = 20;
    }
    boxes.forEach((b, i) => {
      const x = MARGIN + i * (w + gap);
      doc.setFillColor(b.tone.fill);
      doc.roundedRect(x, y, w, height, 2.5, 2.5, 'F');
      doc
        .setFont('helvetica', 'bold')
        .setFontSize(10)
        .setTextColor(b.tone.ink)
        .text(b.title, x + 5, y + 8);
      let ly = y + 14.5;
      b.lines.forEach((lines) => {
        if (b.items.length) {
          doc.setFillColor(b.tone.ink);
          doc.circle(x + 6.5, ly - 1.2, 0.9, 'F');
        }
        doc
          .setFont('helvetica', 'normal')
          .setFontSize(8.5)
          .setTextColor(DARK)
          .text(lines, x + 10, ly);
        ly += lines.length * 4 + 2;
      });
    });
    return y + height;
  }

  // Vertical bars per day; the busiest day in the church's main colour.
  private drawDayChart(
    doc: jsPDF,
    y: number,
    theme: ChurchThemeColors,
    days: { date: string; count: number }[],
    busiest: string | undefined,
    label: (date: string) => string,
  ): number {
    const chartH = 42;
    const max = Math.max(1, ...days.map((d) => d.count));
    const slot = CONTENT_W / days.length;
    const barW = Math.min(16, slot * 0.6);
    doc
      .setDrawColor(theme.accent)
      .setLineWidth(0.2)
      .line(MARGIN, y + chartH, MARGIN + CONTENT_W, y + chartH);
    days.forEach((d, i) => {
      const bh = Math.max(0.8, ((chartH - 8) * d.count) / max);
      const x = MARGIN + i * slot + (slot - barW) / 2;
      doc.setFillColor(d.date === busiest ? theme.brand : theme.accent);
      doc.roundedRect(x, y + chartH - bh, barW, bh, 1, 1, 'F');
      doc
        .setFont('helvetica', 'bold')
        .setFontSize(8)
        .setTextColor(DARK)
        .text(String(d.count), x + barW / 2, y + chartH - bh - 1.5, {
          align: 'center',
        });
      doc
        .setFont('helvetica', 'normal')
        .setFontSize(7)
        .setTextColor(MUTED)
        .text(label(d.date), x + barW / 2, y + chartH + 4.5, {
          align: 'center',
        });
    });
    return y + chartH + 6;
  }

  // Two columns of quote cards with the person's first name.
  private drawQuoteCards(
    doc: jsPDF,
    y: number,
    quotes: { name: string; text: string }[],
    edge: string,
  ): number {
    const gap = 4;
    const w = (CONTENT_W - gap) / 2;
    for (let i = 0; i < quotes.length; i += 2) {
      const pair = quotes.slice(i, i + 2).map((q) => ({
        q,
        lines: doc
          .setFont('helvetica', 'normal')
          .setFontSize(8.5)
          .splitTextToSize(`“${q.text}”`, w - 10) as string[],
      }));
      const h = Math.max(...pair.map((p) => p.lines.length)) * 4 + 11;
      if (y + h > 282) {
        doc.addPage();
        y = 20;
      }
      pair.forEach((p, j) => {
        const x = MARGIN + j * (w + gap);
        doc.setFillColor('#FAFAF8');
        doc.roundedRect(x, y, w, h, 2, 2, 'F');
        doc.setFillColor(edge);
        doc.rect(x, y + 2, 1.2, h - 4, 'F');
        doc
          .setFont('helvetica', 'normal')
          .setFontSize(8.5)
          .setTextColor(DARK)
          .text(p.lines, x + 5, y + 6);
        doc
          .setFont('helvetica', 'bold')
          .setFontSize(7.5)
          .setTextColor(MUTED)
          .text(p.q.name, x + 5, y + h - 3);
      });
      y += h + gap;
    }
    return y - gap;
  }

  // Starts a section on a new page when its title and first rows (or the whole of a short table) won't fit.
  private sectionStart(
    doc: jsPDF,
    y: number,
    title: string,
    rows: number,
  ): number {
    const needed = 14 + (rows <= 8 ? rows : 3) * 7;
    if (y + needed > 280) {
      doc.addPage();
      y = 20;
    }
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(12)
      .setTextColor(DARK)
      .text(title, MARGIN, y);
    return y + 5;
  }

  // Label, count, and a bar on a light track, scaled to the largest count.
  private drawCountTable(
    doc: jsPDF,
    y: number,
    branding: PdfBranding,
    rows: [string, number][],
  ): number {
    const max = Math.max(1, ...rows.map(([, n]) => n));
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      body: rows.map(([label, n]) => [label, String(n), '']),
      columnStyles: {
        0: { cellWidth: CONTENT_W * 0.42 },
        1: { cellWidth: 16, halign: 'right', fontStyle: 'bold' },
      },
      bodyStyles: {
        fontSize: 8.5,
        textColor: DARK,
        fillColor: WHITE,
        cellPadding: 2.2,
      },
      alternateRowStyles: { fillColor: '#FAFAF8' },
      didDrawCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 2) return;
        const n = rows[data.row.index][1];
        const full = data.cell.width - 8;
        const top = data.cell.y + data.cell.height / 2 - 1.6;
        doc.setFillColor(branding.theme.tint);
        doc.roundedRect(data.cell.x + 4, top, full, 3.2, 1.6, 1.6, 'F');
        const w = (full * n) / max;
        if (w <= 0) return;
        doc.setFillColor(
          n === max ? branding.theme.brand : branding.theme.accent,
        );
        doc.roundedRect(
          data.cell.x + 4,
          top,
          Math.max(w, 3.2),
          3.2,
          1.6,
          1.6,
          'F',
        );
      },
    });
    return this.tableEnd(doc);
  }
}
