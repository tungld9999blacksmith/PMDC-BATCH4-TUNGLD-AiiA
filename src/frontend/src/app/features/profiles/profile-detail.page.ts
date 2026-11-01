import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import type { FacetCode, FacetData, Profile360, SubjectType, TimelineEvent } from '../../core/api/models';
import { ProfilesApi } from '../../core/api/services';
import { toProblem } from '../../core/http/problem';
import { DialogsService, type AccessTarget } from '../../core/ui/dialogs.service';
import { FACET_LABELS, SUBJECT_LABELS } from '../../core/util/labels';
import { loader } from '../../shared/async';
import { FreshnessChipComponent } from '../../shared/badges';
import { ChartComponent, type ChartData } from '../../shared/chart';
import { DataTableComponent } from '../../shared/data-table';
import { MaskedValueComponent } from '../../shared/masked-value';
import { PageHeaderComponent } from '../../shared/overlays';
import { ViDatePipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';
import { ProvenanceDrawerComponent } from './provenance-drawer';

const HEADER_LABELS: Record<string, string> = {
  code: 'Mã',
  email: 'Email',
  phone: 'Điện thoại',
  gender: 'Giới tính',
  dateOfBirth: 'Ngày sinh',
  nationalId: 'CCCD',
  orgUnit: 'Đơn vị',
  status: 'Trạng thái',
  cohort: 'Khóa',
  className: 'Lớp',
  program: 'Ngành',
  academicTitle: 'Học hàm, học vị',
  position: 'Chức vụ',
};
const PROVENANCE_ATTRS = ['email', 'phone', 'dateOfBirth', 'nationalId', 'orgUnit'];
const EVENT_TYPES: Record<string, string> = { ADMISSION: 'Nhập học', TERM_RESULT: 'Kết quả học kỳ', TUITION: 'Học phí', AWARD: 'Khen thưởng', LMS_ACTIVITY: 'LMS', PUBLICATION: 'Công bố', PROJECT: 'Đề tài', SUPERVISION: 'Hướng dẫn', TEACHING: 'Giảng dạy', CONTRACT: 'Hợp đồng', TRAINING: 'Bồi dưỡng' };

/** P06 — Chi tiết hồ sơ 360° (US12–US16). */
@Component({
  selector: 'aiia-profile-detail-page',
  standalone: true,
  imports: [PageHeaderComponent, StateViewComponent, MaskedValueComponent, FreshnessChipComponent, DataTableComponent, ChartComponent, ProvenanceDrawerComponent, ViDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profile-detail.page.html',
  styleUrl: './profile-detail.page.css',
})
export class ProfileDetailPage {
  readonly personId = input.required<string>();
  readonly roleParam = input<string | undefined>(undefined, { alias: 'role' });
  readonly tabParam = input<string | undefined>(undefined, { alias: 'tab' });

  private readonly api = inject(ProfilesApi);
  protected readonly router = inject(Router);
  private readonly dialogs = inject(DialogsService);

  protected readonly profile = loader<Profile360>();
  protected readonly facet = loader<FacetData>();
  protected readonly facetLocked = signal<AccessTarget | null>(null);
  protected readonly timeline = signal<TimelineEvent[]>([]);
  protected readonly timelineNext = signal<string | null>(null);
  protected readonly timelineLoading = signal(false);
  protected readonly eventFilter = signal<string[]>([]);
  protected readonly provenanceOf = signal<string | null>(null);

  protected readonly headerLabels = HEADER_LABELS;
  protected readonly subjectLabels = SUBJECT_LABELS;
  protected readonly eventTypes = EVENT_TYPES;
  protected readonly activeTab = computed<FacetCode>(() => (this.tabParam() as FacetCode | undefined) ?? 'OVERVIEW');
  protected readonly headerEntries = computed(() =>
    Object.entries(this.profile.state().data?.header ?? {}).filter(([k]) => k !== 'fullName'),
  );
  protected readonly activeFacet = computed(() => this.profile.state().data?.facets?.find((f) => f.code === this.activeTab()));
  protected readonly initials = computed(() => {
    const name = String(this.profile.state().data?.header?.['fullName']?.value ?? '');
    const parts = name.replace(/^(PGS|GS)\.?|TS\.|ThS\./g, '').trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
  });
  protected readonly eventTypesInTimeline = computed(() => [...new Set(this.timeline().map((e) => e.type ?? ''))]);
  protected readonly visibleTimeline = computed(() => {
    const f = this.eventFilter();
    return f.length ? this.timeline().filter((e) => f.includes(e.type ?? '')) : this.timeline();
  });

  constructor() {
    effect(() => {
      const id = this.personId();
      const role = this.roleParam();
      untracked(() => {
        this.profile.load(this.api.get(id, role));
        this.timeline.set([]);
        this.timelineNext.set(null);
        this.loadTimeline();
      });
    });
    effect(() => {
      const id = this.personId();
      const tab = this.activeTab();
      const ready = this.profile.state().status === 'ready';
      if (!ready) return;
      untracked(() => this.loadFacet(id, tab));
    });
  }

  loadFacet(id: string, facet: FacetCode): void {
    this.facetLocked.set(null);
    this.facet.state.set({ status: 'loading', data: null, error: null });
    this.api.facet(id, facet).subscribe({
      next: (data) => this.facet.set(data),
      error: (e: unknown) => {
        const p = toProblem(e);
        if (p.status === 403 && p.requestable?.resourceType && p.requestable.resourceId) {
          this.facetLocked.set({ resourceType: p.requestable.resourceType, resourceId: p.requestable.resourceId, resourceName: `Tab ${FACET_LABELS[facet] ?? facet} – hồ sơ` });
          this.facet.state.set({ status: 'idle', data: null, error: null });
        } else {
          this.facet.state.set({ status: 'error', data: null, error: p });
        }
      },
    });
  }

  loadTimeline(): void {
    this.timelineLoading.set(true);
    this.api.timeline(this.personId(), { pageSize: 10, before: this.timelineNext() }).subscribe({
      next: (page) => {
        this.timeline.update((list) => [...list, ...page.items]);
        this.timelineNext.set(page.nextBefore);
        this.timelineLoading.set(false);
      },
      error: () => this.timelineLoading.set(false),
    });
  }

  selectTab(code: FacetCode | undefined): void {
    void this.router.navigate([], { queryParams: { tab: code === 'OVERVIEW' ? null : code }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  switchRole(role: SubjectType): void {
    void this.router.navigate([], { queryParams: { role, tab: null }, queryParamsHandling: 'merge' });
  }

  toggleEvent(type: string): void {
    this.eventFilter.update((f) => (f.includes(type) ? f.filter((x) => x !== type) : [...f, type]));
  }

  requestFacet(): void {
    const target = this.facetLocked();
    if (target) this.dialogs.requestAccess(target);
  }

  kpiRequest(code: string | undefined): AccessTarget | null {
    const facet: Record<string, FacetCode> = { tuition_status: 'FINANCE', teaching_score: 'EVALUATION', grade: 'HR' };
    const f = code ? facet[code] : undefined;
    return f ? { resourceType: 'PROFILE_FACET', resourceId: f, resourceName: `Tab ${FACET_LABELS[f]} – hồ sơ` } : null;
  }

  canProvenance(key: string): boolean {
    return PROVENANCE_ATTRS.includes(key);
  }

  seriesChart(series: NonNullable<FacetData['series']>[number]): ChartData {
    return { type: 'LINE', categories: (series.points ?? []).map((p) => p.x ?? ''), series: [{ name: series.code === 'gpa_by_term' ? 'GPA' : series.code === 'conduct_by_term' ? 'Điểm rèn luyện' : 'Giờ giảng', values: (series.points ?? []).map((p) => p.y ?? null) }] };
  }

  fieldEntries(data: FacetData) {
    return Object.entries(data.fields ?? {});
  }
}
