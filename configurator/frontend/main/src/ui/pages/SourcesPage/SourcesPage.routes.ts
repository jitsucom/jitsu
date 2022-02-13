export const sourcesPageRoutes = {
  root: "/prj_:projectId/sources",
  add: "/prj_:projectId/sources/add",
  edit: "/prj_:projectId/sources/edit",
  addExact: "/prj_:projectId/sources/add/:source/:tabName?",
  editExact: "/prj_:projectId/sources/edit/:sourceId",
} as const
