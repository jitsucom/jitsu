// @Libs
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from 'antd';
// @Store
import { sourcesStore, SourcesStoreState } from 'stores/sources';
import { destinationsStore, DestinationsStoreState } from 'stores/destinations';
// @Styles
import styles from './OnboardingTourAddDestination.module.less';
// @Commons
import { createFreeDatabase } from 'lib/commons/createFreeDatabase';
// @Components
import { EmptyListView } from 'ui/components/EmptyList/EmptyListView';
import { DropDownList } from 'ui/components/DropDownList/DropDownList';
import { DestinationEditor } from 'ui/pages/DestinationsPage/partials/DestinationEditor/DestinationEditor';
import {
  destinationsReferenceList,
  destinationsReferenceMap,
  DestinationStrictType
} from 'catalog/destinations/lib';
import { Destination } from 'catalog/destinations/types';

// @Hooks
import { useServices } from 'hooks/useServices';
// @Utils
import ApiKeyHelper from 'lib/services/ApiKeyHelper';

type ExtractDatabaseOrWebhook<T> = T extends {readonly type: 'database'}
  ? T
  : T extends {readonly id: 'webhook'}
    ? T
    : never;

const destinationsToOffer = destinationsReferenceList.filter(
  (dest): dest is ExtractDatabaseOrWebhook<DestinationStrictType> => {
    return !dest.hidden && (dest.type === 'database' || dest.id === 'webhook');
  }
)

type NamesOfDestinationsToOffer = (typeof destinationsToOffer)[number]['id'];

type Lifecycle =
  | 'loading'
  | 'setup_choice'
  | NamesOfDestinationsToOffer;

type Props = {
   handleGoNext: () => void;
   handleSkip?: () => void;
 }

export const OnboardingTourAddDestination: React.FC<Props> = function({
  handleGoNext,
  handleSkip
}) {
  const services = useServices();
  const [lifecycle, setLifecycle] = useState<Lifecycle>('loading');

  const needShowCreateDemoDatabase = useMemo<boolean>(() => services.features.createDemoDatabase, [
    services.features.createDemoDatabase
  ]);

  
  const userSources = sourcesStore.sources;
  const userDestinations = destinationsStore.destinations;

  const isLoadingUserSources = sourcesStore.state === SourcesStoreState.GLOBAL_LOADING
  const isLoadingUserDestinations = destinationsStore.state === DestinationsStoreState.GLOBAL_LOADING

  const handleCancelDestinationSetup = useCallback<() => void>(() => {
    setLifecycle('setup_choice');
  }, []);

  const onAfterCustomDestinationCreated = useCallback<() => Promise<void>>(async() => {
    const helper = new ApiKeyHelper(services);
    await helper.init();

    // if user created a destination at this step, it is his first destination
    const destination = helper.destinations[0];
    if (!destination) {
      const errorMessage = 'onboarding - silently failed to create a custom destination'
      console.error(errorMessage)
      services.analyticsService.track(
        'onboarding_destination_error_custom',
        { error: errorMessage }
      );
      handleGoNext();
      return;
    }

    // track successful destination creation
    services.analyticsService.track(`onboarding_destination_created_${destination._type}`);

    // user might have multiple keys - we are using the first one
    let key = helper.keys[0];
    if (!key) key = await helper.createNewAPIKey();
    await helper.linkKeyToDestination(key, destination);

    handleGoNext();
  }, [services, handleGoNext])

  const handleCreateFreeDatabase = useCallback<() => Promise<void>>(async() => {
    try {
      await createFreeDatabase();
    } catch (error) {
      services.analyticsService.track('onboarding_destination_error_free', { error });
    }
    services.analyticsService.track('onboarding_destination_created_free');
    handleGoNext();
  }, [services, handleGoNext])

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
          <p className={styles.paragraph}>
            {`Looks like you don't have destinations set up. Let's create one.`}
          </p>
          <div className={styles.addDestinationButtonContainer}>
            <EmptyListView
              title=""
              list={list}
              unit="destination"
              centered={false}
              dropdownOverlayPlacement="bottomCenter"
              hideFreeDatabaseSeparateButton={!needShowCreateDemoDatabase}
              handleCreateFreeDatabase={handleCreateFreeDatabase}
            />
          </div>
          {!needShowCreateDemoDatabase && handleSkip && (
            <div className="absolute bottom-0 left-50">
              <Button type="text" onClick={handleSkip}>{'Skip'}</Button>
            </div>
          )}
        </>
      );

    default:
      return (
        <div className={styles.destinationEditorContainer}>
          <DestinationEditor
            setBreadcrumbs={() => {}}
            editorMode="add"
            paramsByProps={{
              type: destinationsReferenceMap[lifecycle]['id'],
              id: '',
              tabName: 'tab'
            }}
            disableForceUpdateOnSave
            onAfterSaveSucceded={onAfterCustomDestinationCreated}
            onCancel={handleCancelDestinationSetup}
          />
        </div>
      );
    }
  }, [
    lifecycle,
    userDestinations,
    userSources,
    needShowCreateDemoDatabase,
    handleSkip,
    handleCancelDestinationSetup,
    onAfterCustomDestinationCreated,
    handleCreateFreeDatabase
  ])

  useEffect(() => {
    if (!isLoadingUserDestinations && !isLoadingUserSources) setLifecycle('setup_choice')
  }, [isLoadingUserDestinations, isLoadingUserSources])

  return (
    <div className={styles.mainContainer}>
      <h1 className={styles.header}>
        {'🔗 Destinations Setup'}
      </h1>
      {render}
    </div>
  );
}