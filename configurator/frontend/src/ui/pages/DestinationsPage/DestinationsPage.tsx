import React from 'react';
import { Route, Switch, useHistory } from 'react-router-dom';
import DestinationsList from "@page/DestinationsPage/partials/DestinationsList/DestinationsList";
import { MappingEditor } from "@page/DestinationsPage/partials/MappingEditor/MappingEditor";
import { destinationPageRoutes } from "./DestinationsPage.routes";
import DestinationEditor from "@page/DestinationsPage/partials/DestinationEditor/DestinationEditor";

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