export const sourcesPageRoutes = {
  root: "/prj-:projectId/sources",
  add: "/prj-:projectId/sources/add",
  edit: "/prj-:projectId/sources/edit",
  addExact: "/prj-:projectId/sources/add/:source/:tabName?",
  editExact: "/prj-:projectId/sources/edit/:sourceId",
  logs: "/prj-:projectId/sources/logs/:sourceId",
  task: "/prj-:projectId/sources/logs/:sourceId/:taskId",
} as const
