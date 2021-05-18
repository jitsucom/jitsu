export type CurrentPlanProps = {
  planTitle: string,
  planId: string
  usage: number
  limit: number
  onPlanChangeModalOpen: () => void,
}