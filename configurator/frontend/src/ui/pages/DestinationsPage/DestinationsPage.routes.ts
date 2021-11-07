export const destinationPageRoutes = {
  root: "/destinations",
  edit: "/destinations/edit",
  statistics: "/destinations/statistics",
  newExact: "/destinations/new/:type/:tabName?",
  editExact: "/destinations/edit/:id/:tabName?",
  statisticsExact: "/destinations/statistics/:id",
} as const
