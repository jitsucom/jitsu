// @Libs
import { Button } from 'antd';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
// @Styles
import styles from './OnboardingTourAddDestination.module.less';
// @Components
import { EmptyListView } from '@./ui/components/EmptyList/EmptyListView';
import { DropDownList } from '@./ui/components/DropDownList/DropDownList';
import { DestinationEditor } from 'ui/pages/DestinationsPage/partials/DestinationEditor/DestinationEditor';
import {
  destinationsReferenceList,
  destinationsReferenceMap,
  DestinationStrictType
} from '@./ui/pages/DestinationsPage/commons';
import useLoader from '@./hooks/useLoader';
import { useServices } from '@./hooks/useServices';

type ExtractDatabaseOrWebhook<T> = T extends {readonly type: 'database'}
  ? T
  : T extends {readonly id: 'webhook'}
    ? T
    : never;

const destinationsToOffer = destinationsReferenceList.filter(
  (dest): dest is ExtractDatabaseOrWebhook<DestinationStrictType> => {
    return dest.type === 'database' || dest.id === 'webhook';
  }
)

type NamesOfDestinationsToOffer = (typeof destinationsToOffer)[number]['id'];

type Lifecycle =
  | 'loading'
  | 'setup_choice'
  | NamesOfDestinationsToOffer;

type Props = {
   handleGoNext: () => void;
   handleGoBack: () => void;
 }

export const OnboardingTourAddDestination: React.FC<Props> = function({
  handleGoNext,
  handleGoBack
}) {
  const services = useServices();
  const [lifecycle, setLifecycle] = useState<Lifecycle>('loading');

  const [sourcesError, sources, updateSources,, isLoadingUserSources] = useLoader(
    async() => await services.storageService.get('sources', services.activeProject.id)
  );
  const [, destinations,, updateDestinations, isLoadingUserDestinations ] = useLoader(
    async() => await services.storageService.get('destinations', services.activeProject.id)
  );

  const userSources = useMemo(() => sources?.sources ?? [], [sources])
  const userDestinations = useMemo(() =>  destinations?.destinations ?? [], [destinations])

  const handleCancelDestinationSetup = useCallback<() => void>(() => {
    setLifecycle('setup_choice');
  }, [])

  const render = useMemo<React.ReactElement>(() => {
    switch (lifecycle) {

    case 'loading':
      return null;

    case 'setup_choice':
      const list = <DropDownList
        hideFilter
        list={destinationsToOffer.map((dst) => ({
          title: dst.displayName,
          id: dst.id,
          icon: dst.ui.icon,
          handleClick: () => setLifecycle(dst.id)
        }))}
      />
      return (
        <>
          <p className={styles.contentText}>
            {`Looks like you don't have destinations set up. Let's create one.`}
          </p>
          <div className={styles.addDestinationButtonContainer}>
            <EmptyListView
              title=""
              list={list}
              unit="destination"
              centered={false}
              dropdownOverlayPlacement="bottomCenter"
              showFreeDatabaseSeparateButton={false}
            />
          </div>
        </>
      );

    default:
      return (
        <div className={styles.destinationEditorContainer}>
          <DestinationEditor
            destinations={userDestinations}
            setBreadcrumbs={() => {}}
            updateDestinations={updateDestinations}
            editorMode="add"
            sources={userSources}
            sourcesError={sourcesError}
            updateSources={updateSources}
            paramsByProps={{
              type: destinationsReferenceMap[lifecycle]['id'],
              id: '',
              tabName: 'tab'
            }}
            disableForceUpdateOnSave
            onAfterSaveSucceded={handleGoNext}
            onCancel={handleCancelDestinationSetup}
          />
        </div>
      );
    }
  }, [
    lifecycle,
    userDestinations,
    userSources,
    sourcesError,
    updateDestinations,
    updateSources,
    handleGoNext,
    handleCancelDestinationSetup
  ])

  useEffect(() => {
    if (!isLoadingUserDestinations && !isLoadingUserSources) setLifecycle('setup_choice')
  }, [isLoadingUserDestinations, isLoadingUserSources])

  return (
    <div className={styles.mainContainer}>
      <h1 className={styles.header}>
        {'Destinations Setup'}
      </h1>
      {render}
    </div>
  );
}