export const sourcesPageRoutes = {
  root: '/sources',
  add: '/sources/add',
  edit: '/sources/edit',
  addExact: '/sources/add/:source/:tabName?',
  editExact: '/sources/edit/:sourceId'
} as const;
