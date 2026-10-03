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
  // Story: Authentication and Roles — public accept-invite screen
  {
    path: 'accept-invite/:token',
    loadComponent: () =>
      import('./authentication-and-roles/accept-invite.component').then(m => m.AcceptInviteComponent),
    data: { hideSupportFooter: true },
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
  // Story: Message Reference and Annotation (before the 'projects' layout route so it is not swallowed)
  {
    path: 'projects/:id/references/:referenceId',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./message-reference-and-annotation/reference-panel.component').then(m => m.ReferencePanelComponent),
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
      // Story: File Explorer — /projects/:id/files and /projects/:id/files/:folderId,
      // rendered inside the app shell (LayoutComponent) behind authGuard.
      {
        path: ':id/files',
        loadComponent: () =>
          import('./file-explorer/file-explorer.component').then(m => m.FileExplorerComponent),
      },
      {
        path: ':id/files/:folderId',
        loadComponent: () =>
          import('./file-explorer/file-explorer.component').then(m => m.FileExplorerComponent),
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
