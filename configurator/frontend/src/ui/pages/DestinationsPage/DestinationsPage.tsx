// @Libs
import React from 'react';
import { Route, Switch } from 'react-router-dom';
// @Pages
import { DestinationsList } from './partials/DestinationsList';
import { DestinationEditor } from '@page/DestinationsPage/partials/DestinationEditor/DestinationEditor';
// @Routes
import { destinationPageRoutes } from './DestinationsPage.routes';

export const DestinationsPage = () => {
  return (
    <Switch>
      <Route path={destinationPageRoutes.root} exact component={DestinationsList} />
      <Route path={destinationPageRoutes.newDestination} strict={false} exact component={DestinationEditor} />
      <Route path={destinationPageRoutes.editDestination} strict={false} exact component={DestinationEditor} />
    </Switch>
  );
};

export default DestinationsPage;
