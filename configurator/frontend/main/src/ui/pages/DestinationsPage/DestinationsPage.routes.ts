export const destinationPageRoutes = {
  root: "/prj-:projectId/destinations",
  add: "/prj-:projectId/destinations/add",
  edit: "/prj-:projectId/destinations/edit",
  statistics: "/prj-:projectId/destinations/statistics",
  newExact: "/prj-:projectId/destinations/new/:type/:tabName?",
  editExact: "/prj-:projectId/destinations/edit/:id/:tabName?",
  statisticsExact: "/prj-:projectId/destinations/statistics/:id",
} as const
