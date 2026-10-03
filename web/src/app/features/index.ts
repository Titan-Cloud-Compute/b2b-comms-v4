import { Routes } from '@angular/router';
import { authGuard } from '../shared/auth.guard';

/**
 * Feature route registry.
 *
 * Each story appends its Angular routes to this array.
 * app.routes.ts spreads FEATURE_ROUTES before the wildcard catch-all so new
 * feature routes are picked up automatically.
 *
 * Example (in features/my-feature/my-feature.routes.ts):
 *
 *   import { FEATURE_ROUTES } from '../index';
 *   FEATURE_ROUTES.push({ path: 'my-feature', loadComponent: () => ... });
 *
 * Or add routes here directly.
 */
export const FEATURE_ROUTES: Routes = [
  // Story: File Explorer
  {
    path: 'projects/:id/files',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./file-explorer/file-explorer.component').then(m => m.FileExplorerComponent),
  },
  {
    path: 'projects/:id/files/:folderId',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./file-explorer/file-explorer.component').then(m => m.FileExplorerComponent),
  },
  // Story: Active Question Chats
  {
    path: 'projects/:id/questions',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./active-question-chats/active-questions.component').then(m => m.ActiveQuestionsComponent),
  },
  {
    path: 'projects/:id/questions/:channelId',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./active-question-chats/active-question-page.component').then(m => m.ActiveQuestionPageComponent),
  },
  // Projects and External Organization Spaces
  {
    path: 'projects',
    loadComponent: () => import('../shared/layout.component').then(m => m.LayoutComponent),
    canActivate: [authGuard],
    data: { rendersSupportFooterInLayout: true },
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./projects-and-external-organization-spaces/project-list.component')
            .then(m => m.ProjectListComponent),
      },
      {
        path: 'new',
        loadComponent: () =>
          import('./projects-and-external-organization-spaces/project-list.component')
            .then(m => m.ProjectListComponent),
      },
      {
        path: ':id',
        loadComponent: () =>
          import('./projects-and-external-organization-spaces/project-detail.component')
            .then(m => m.ProjectDetailComponent),
      },
    ],
  },
];
