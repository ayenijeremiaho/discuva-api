import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
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
import { TitheRecord } from '../../tithe/entity/tithe-record.entity';
import { Member } from '../../member/entity/member.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { CacheService } from './cache.service';

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
}

const DARK = '#121212';
const MUTED = '#8A817C';
const ACCENT = '#EADCC9';
const LIGHT_GOLD = '#F4EDE4';
const DANGER = '#C0392B';
const SUCCESS = '#2E7D32';
const WHITE = '#FFFFFF';

const PAGE_W = 210;
const MARGIN = 18;
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
  ) {
    this.cacheTtl = this.config.get<number>('CACHE_TTL_REFERENCE_SECONDS', 300);
  }

  // Shares the same `tenant-branding:${tenantId}` cache entry
  // EmailQueueService populates — same underlying Tenant row, so no reason
  // for a second cache key/DB round trip. currencyLocale has no tenant-scoped
  // equivalent (Tenant has no locale column) and stays a pure global default.
  private async resolveBranding(): Promise<PdfBranding> {
    const fallback: PdfBranding = {
      churchName: this.config.get<string>('CHURCH_NAME'),
      churchAddress: this.config.get<string>('CHURCH_ADDRESS'),
      churchTagline: this.config.get<string>('CHURCH_TAGLINE'),
      currencyCode: this.config.get<string>('CURRENCY_CODE'),
      currencyLocale: this.config.get<string>('CURRENCY_LOCALE'),
    };

    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return fallback;

    const tenant = await this.cacheService.getOrSet(
      `tenant-branding:${tenantId}`,
      () => this.tenantRepository.findOneBy({ id: tenantId }),
      this.cacheTtl,
    );
    if (!tenant) return fallback;

    return {
      churchName: tenant.name || fallback.churchName,
      churchAddress: tenant.address || fallback.churchAddress,
      churchTagline: tenant.tagline || fallback.churchTagline,
      currencyCode: tenant.currency || fallback.currencyCode,
      currencyLocale: fallback.currencyLocale,
    };
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

  async generateTitheStatement(
    member: Member,
    records: TitheRecord[],
    period?: { from?: string; to?: string },
  ): Promise<Buffer> {
    const branding = await this.resolveBranding();
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    this.drawTitheStatement(doc, member, records, branding, period);
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

  // ─── Session report ──────────────────────────────────────────────────────

  private drawSessionReport(
    doc: jsPDF,
    report: SessionReport,
    branding: PdfBranding,
  ): void {
    let y = this.drawPageHeader(doc, 'Service Session Report', branding);

    y = this.drawAccentBand(
      doc,
      y,
      report.programme.serviceSlotName ?? 'Session',
      this.fmtDate(report.startedAt),
    );

    y = this.drawLabelValueGrid(doc, y + 4, [
      ['Session Code', report.sessionCode],
      ['Started', this.fmtTime(report.startedAt)],
      ['Ended', report.endedAt ? this.fmtTime(report.endedAt) : '—'],
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
          this.fmtSlotTimeRange(slot),
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
        fillColor: ACCENT,
        textColor: DARK,
        fontStyle: 'bold',
        fontSize: 9,
      },
      bodyStyles: { fontSize: 9, textColor: DARK, fillColor: WHITE },
      alternateRowStyles: { fillColor: LIGHT_GOLD },
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
          fillColor: ACCENT,
          textColor: DARK,
          fontStyle: 'bold',
          fontSize: 9,
        },
        bodyStyles: { fontSize: 9, textColor: MUTED, fillColor: WHITE },
        alternateRowStyles: { fillColor: LIGHT_GOLD },
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
    this.drawTimeSummaryBand(doc, summaryY, report);

    this.drawPageFooter(doc, branding);
  }

  // ─── Tithe statement ─────────────────────────────────────────────────────

  private drawTitheStatement(
    doc: jsPDF,
    member: Member,
    records: TitheRecord[],
    branding: PdfBranding,
    period?: { from?: string; to?: string },
  ): void {
    let y = this.drawPageHeader(doc, 'Tithe Statement', branding);

    const total = records.reduce((sum, r) => sum + Number(r.amount), 0);

    const generatedText = `Generated: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`;

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
      y,
      `${this.cap(member.firstname)} ${this.cap(member.lastname)}`,
      generatedText,
      periodLabel,
      periodValue,
    );

    y = this.drawLabelValueGrid(doc, y + 4, [
      ['Email', member.email],
      ['Phone', member.phoneNumber ?? '—'],
      ['Total Records', `${records.length}`],
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
          'Month',
          'Date',
          `Amount (${branding.currencyCode})`,
          'Bank',
          'Reference',
        ],
      ],
      body: records.map((r) => {
        const [yr, mo] = r.paymentDate.split('-').map(Number);
        const monthName = new Date(yr, mo - 1, 1).toLocaleDateString('en-GB', {
          month: 'long',
          year: 'numeric',
        });
        return [
          monthName,
          r.paymentDate,
          Number(r.amount).toLocaleString(branding.currencyLocale, {
            minimumFractionDigits: 2,
          }),
          r.bankName ?? '—',
          r.reference ?? '—',
        ];
      }),
      foot: [
        [
          'Total',
          '',
          `${branding.currencyCode} ${total.toLocaleString(branding.currencyLocale, { minimumFractionDigits: 2 })}`,
          '',
          '',
        ],
      ],

      columnStyles: {
        0: { cellWidth: 30 },
        1: { cellWidth: 24 },
        2: { cellWidth: 36, halign: 'right' },
        3: { cellWidth: 36 },
        4: { cellWidth: 44 },
      },
      headStyles: {
        fillColor: ACCENT,
        textColor: DARK,
        fontStyle: 'bold',
        fontSize: 9,
      },
      bodyStyles: { fontSize: 9, textColor: DARK, fillColor: WHITE },
      alternateRowStyles: { fillColor: LIGHT_GOLD },
      footStyles: {
        fillColor: DARK,
        textColor: WHITE,
        fontStyle: 'bold',
        fontSize: 9,
      },
      showFoot: 'lastPage',
      didParseCell: (data) => {
        if (data.section === 'foot' && data.column.index === 2) {
          data.cell.styles.halign = 'right';
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

    let y = this.drawPageHeader(doc, 'Sunday Service Report', branding);
    y = this.drawAccentBand(doc, y, report.eventName, eventDateFormatted);
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
        ['Service', 'Allocated', 'Duration', 'Pauses', 'Slot Var.', 'Cmpl.'],
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
        fillColor: ACCENT,
        textColor: DARK,
        fontStyle: 'bold',
        fontSize: 9,
      },
      bodyStyles: { fontSize: 9, textColor: DARK, fillColor: WHITE },
      alternateRowStyles: { fillColor: LIGHT_GOLD },
      footStyles: {
        fillColor: DARK,
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
      const slotTime = `${this.fmtTime(entry.slotStartTime)} – ${this.fmtTime(entry.slotEndTime)}`;
      const r = entry.report;

      if (y > 220) {
        doc.addPage();
        y = MARGIN;
      }

      y = this.drawSectionDivider(doc, y, entry.serviceSlotName, slotTime);
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
            this.fmtSlotTimeRange(slot),
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
          fillColor: ACCENT,
          textColor: DARK,
          fontStyle: 'bold',
          fontSize: 9,
        },
        bodyStyles: { fontSize: 9, textColor: DARK, fillColor: WHITE },
        alternateRowStyles: { fillColor: LIGHT_GOLD },
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
            fillColor: ACCENT,
            textColor: DARK,
            fontStyle: 'bold',
            fontSize: 9,
          },
          bodyStyles: { fontSize: 9, textColor: MUTED, fillColor: WHITE },
          alternateRowStyles: { fillColor: LIGHT_GOLD },
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
      y = this.drawTimeSummaryBand(doc, bandY, r) + 8;
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

    doc.setFillColor(DARK);
    doc.rect(0, 0, PAGE_W, 22, 'F');
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(9)
      .setTextColor(WHITE)
      .text(branding.churchName, MARGIN, 10);
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(8)
      .setTextColor(ACCENT)
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
      .setDrawColor(ACCENT)
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
      doc.setFillColor(ACCENT);
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
        1: { cellWidth: 36 },
        2: { cellWidth: 54 },
        3: { cellWidth: 20, halign: 'right' },
        4: { cellWidth: 20, halign: 'right' },
        5: { cellWidth: 16, halign: 'right' },
        6: { cellWidth: 18 },
      },
      headStyles: {
        fillColor: ACCENT,
        textColor: DARK,
        fontStyle: 'bold',
        fontSize: 8.5,
      },
      bodyStyles: { fontSize: 8.5, textColor: DARK, fillColor: WHITE },
      alternateRowStyles: { fillColor: LIGHT_GOLD },
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
      slot?.name ?? 'Service Programme',
      dateLabel,
      branding,
    );
    this.drawOrderOfServiceTable(
      doc,
      y,
      slot?.name ?? 'Service',
      slot?.startTime ?? null,
      sorted,
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
        y = this.drawNoProgammePlaceholder(doc, y, slot);
        continue;
      }

      const sorted = [...(programme.slots ?? [])].sort(
        (a, b) => a.position - b.position,
      );
      y = this.drawOrderOfServiceTable(
        doc,
        y,
        slot.name,
        slot.startTime ?? null,
        sorted,
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
    doc.setFillColor(DARK);
    doc.rect(0, 0, PAGE_W, 22, 'F');
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(9)
      .setTextColor(WHITE)
      .text(branding.churchName, MARGIN, 10);
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(8)
      .setTextColor(ACCENT)
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
      .setDrawColor(ACCENT)
      .setLineWidth(0.5)
      .line(MARGIN, 52, PAGE_W - MARGIN, 52);
    return 58;
  }

  private drawOrderOfServiceTable(
    doc: jsPDF,
    y: number,
    serviceName: string,
    serviceStart: Date | null,
    slots: ServiceProgrammeSlot[],
  ): number {
    const hasBackup = slots.some((s) => s.backupMember || s.backupGuestName);

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
      const rowStart = cursor ? this.fmtTime(cursor) : '—';
      const rowEnd = cursor
        ? this.fmtTime(new Date(cursor.getTime() + mins * 60_000))
        : '—';
      if (cursor) cursor = new Date(cursor.getTime() + mins * 60_000);
      totalMinutes += mins;

      let minister = '—';
      if (s.member)
        minister = `${this.cap(s.member.firstname)} ${this.cap(s.member.lastname)}`;
      else if (s.guestName) minister = s.guestName;

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
        row.push(backup);
      }

      rows.push(row);
    }

    const totalLabel = this.fmtTotalDuration(totalMinutes);
    const finalTime = cursor ? this.fmtTime(cursor) : '—';
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
              fillColor: DARK,
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
        fillColor: ACCENT,
        textColor: DARK,
        fontStyle: 'bold',
        fontSize: 8.5,
      },
      bodyStyles: { fontSize: 9, textColor: DARK, fillColor: WHITE },
      alternateRowStyles: { fillColor: LIGHT_GOLD },
      footStyles: {
        fillColor: DARK,
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
    y: number,
    slot: ServiceSlot,
  ): number {
    const timeLabel =
      slot.startTime && slot.endTime
        ? `${this.fmtTime(slot.startTime)} – ${this.fmtTime(slot.endTime)}`
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
              fillColor: DARK,
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
      headStyles: { fillColor: DARK, textColor: WHITE },
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
    y: number,
    title: string,
    subtitle: string,
  ): number {
    doc.setFillColor(DARK);
    doc.rect(MARGIN, y, CONTENT_W, 9, 'F');
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(9)
      .setTextColor(WHITE)
      .text(title, MARGIN + 4, y + 6);
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(8)
      .setTextColor(ACCENT)
      .text(subtitle, PAGE_W - MARGIN - 4, y + 6, { align: 'right' });
    return y + 9;
  }

  // ─── Shared layout helpers ────────────────────────────────────────────────

  private drawPageHeader(
    doc: jsPDF,
    title: string,
    branding: PdfBranding,
  ): number {
    doc.setFillColor(DARK);
    doc.rect(0, 0, PAGE_W, 22, 'F');

    doc
      .setFont('helvetica', 'bold')
      .setFontSize(9)
      .setTextColor(WHITE)
      .text(branding.churchName, MARGIN, 10);

    doc
      .setFont('helvetica', 'normal')
      .setFontSize(8)
      .setTextColor(ACCENT)
      .text(branding.churchTagline, PAGE_W - MARGIN, 10, { align: 'right' });

    doc
      .setFont('helvetica', 'bold')
      .setFontSize(15)
      .setTextColor(DARK)
      .text(title, MARGIN, 36);

    doc
      .setDrawColor(ACCENT)
      .setLineWidth(0.6)
      .line(MARGIN, 40, PAGE_W - MARGIN, 40);

    return 48;
  }

  private drawAccentBand(
    doc: jsPDF,
    y: number,
    primary: string,
    secondary: string,
    rightLabel?: string,
    rightValue?: string,
  ): number {
    const h = 14;
    doc.setFillColor(ACCENT);
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
    y: number,
    report: SessionReport,
  ): number {
    const h = 14;
    doc.setFillColor(ACCENT);
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
        .setDrawColor(ACCENT)
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

  private fmtDate(date: Date): string {
    return new Date(date).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }

  private fmtTime(date: Date): string {
    return new Date(date).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }

  private fmtSlotTimeRange(slot: SessionSlotReport): string {
    if (!slot.startedAt) return '—';
    const start = this.fmtTime(slot.startedAt);
    if (!slot.completedAt) return `${start} –`;
    return `${start} – ${this.fmtTime(slot.completedAt)}`;
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
}
