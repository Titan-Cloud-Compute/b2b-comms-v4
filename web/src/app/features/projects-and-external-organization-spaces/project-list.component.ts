import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/auth.service';
import {
  OrganizationType,
  ProjectListItem,
  ProjectsApi,
} from './projects-api.service';

@Component({
  selector: 'app-project-list',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="projects-page">
      <h1>Projects</h1>

      @if (canCreate()) {
        <form data-testid="create-project-form" (ngSubmit)="create()">
          <h2>New project</h2>
          <label>
            Organization name
            <input data-testid="org-name" name="orgName" [(ngModel)]="orgName" />
          </label>
          <label>
            Type
            <select data-testid="org-type" name="orgType" [(ngModel)]="orgType">
              @for (t of types; track t) { <option [value]="t">{{ t }}</option> }
            </select>
          </label>
          <button type="submit" data-testid="create-project" [disabled]="saving()">Create project</button>
          @if (createError()) {
            <p class="error" role="alert" data-testid="create-project-error">{{ createError() }}</p>
          }
        </form>
      }

      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

      <ul data-testid="project-list">
        @for (p of projects(); track p.id) {
          <li data-testid="project-row">
            <a data-testid="project-link" [routerLink]="['/projects', p.id]">{{ p.organization.name }}</a>
            @if (p.name !== p.organization.name) { <span> — {{ p.name }}</span> }
            <span class="org-type"> ({{ p.organization.type }})</span>
          </li>
        } @empty {
          @if (!loading()) { <li data-testid="project-empty">No projects yet.</li> }
        }
      </ul>

      @if (total() > pageSize) {
        <nav data-testid="project-pagination">
          <button type="button" [disabled]="page() <= 1" (click)="go(page() - 1)">Previous</button>
          <span>Page {{ page() }}</span>
          <button type="button" [disabled]="page() * pageSize >= total()" (click)="go(page() + 1)">Next</button>
        </nav>
      }
    </section>
  `,
})
export class ProjectListComponent implements OnInit {
  private api = inject(ProjectsApi);
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly types: OrganizationType[] = ['vendor', 'customer', 'client', 'other'];
  readonly pageSize = 20;

  projects = signal<ProjectListItem[]>([]);
  page = signal(1);
  total = signal(0);
  loading = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  createError = signal<string | null>(null);

  orgName = '';
  orgType: OrganizationType = 'vendor';

  canCreate = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'MANAGER' || role === 'ADMIN' || role === 'SUPER_ADMIN';
  });

  ngOnInit(): void {
    void this.go(1);
  }

  async go(page: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.list(page, this.pageSize);
      this.projects.set(res.items ?? []);
      this.page.set(res.page ?? page);
      this.total.set(res.total ?? res.items?.length ?? 0);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not load projects');
    } finally {
      this.loading.set(false);
    }
  }

  async create(): Promise<void> {
    this.createError.set(null);
    if (!this.orgName.trim()) {
      this.createError.set('Organization name is required');
      return;
    }
    this.saving.set(true);
    try {
      const res = await this.api.create({
        organization_name: this.orgName.trim(),
        organization_type: this.orgType,
      });
      this.orgName = '';
      await this.router.navigate(['/projects', res.id]);
    } catch (e) {
      this.createError.set(e instanceof Error ? e.message : 'Could not create project');
    } finally {
      this.saving.set(false);
    }
  }
}
