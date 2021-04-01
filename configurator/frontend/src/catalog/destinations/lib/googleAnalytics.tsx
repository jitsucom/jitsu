import { Destination } from '../types';
import { filteringExpressionDocumentation, modeParameter, tableName } from './common';
import { stringType } from '../../sources/types';

const googleAnalytics: Destination = {
  displayName: "GoogleAnalytics",
  id: "google_analytics",
  parameters: [
    modeParameter("stream"),
    tableName(filteringExpressionDocumentation),
    {
      id: "_formData.gaTrackingId",
      displayName: "Tracking ID",
      required: true,
      type: stringType
    }

  ],
  ui: undefined
}

export default googleAnalytics;