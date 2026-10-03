import { Routes } from '@angular/router';
import { authGuard } from '../../shared/auth.guard';

export const GENERAL_CHANNELS_ROUTES: Routes = [
  {
    path: 'projects/:projectId/channels/:channelId',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./channels-page.component').then(m => m.ChannelsPageComponent),
  },
  {
    path: 'projects/:projectId/channels',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./channels-page.component').then(m => m.ChannelsPageComponent),
  },
];
