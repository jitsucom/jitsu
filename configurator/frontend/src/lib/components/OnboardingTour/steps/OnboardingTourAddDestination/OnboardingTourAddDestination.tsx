// @Libs
import { Button } from 'antd';
import React, { useMemo, useState } from 'react';
// @Styles
import styles from './OnboardingTourAddDestination.module.less';
// @Components
import { EmptyListView } from '@./ui/components/EmptyList/EmptyListView';
import { DropDownList } from '@./ui/components/DropDownList/DropDownList';
import { destinationsReferenceList, DestinationStrictType } from '@./ui/pages/DestinationsPage/commons';
import { Destination } from '@./catalog/destinations/types';

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
  | 'empty_list'
  | NamesOfDestinationsToOffer;

type Props = {
   handleGoNext: () => void;
   handleGoBack: () => void;
 }

export const OnboardingTourAddDestination: React.FC<Props> = function({
  handleGoNext,
  handleGoBack
}) {
  const [lifecycle, setLifecycle] = useState<Lifecycle>('empty_list');

  const render = useMemo<React.ReactElement>(() => {
    switch (lifecycle) {

    case 'empty_list':
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

    case 'postgres':
      return null;

    case 'bigquery':
      return null;

    case 'clickhouse':
      return null;

    case 'webhook':
      return null;
    }
  }, [lifecycle])

  return (
    <div className={styles.mainContainer}>
      <h1 className={styles.header}>
        {'Destinations Setup'}
      </h1>
      {/* <div className={styles.controlsContainer}>
        <Button type="ghost" className={styles.withButtonsMargins} onClick={handleGoBack}>{'Back'}</Button>
        <Button type="primary" className={styles.withButtonsMargins} onClick={handleGoNext}>{'Next'}</Button>
      </div> */}
    </div>
  );
}