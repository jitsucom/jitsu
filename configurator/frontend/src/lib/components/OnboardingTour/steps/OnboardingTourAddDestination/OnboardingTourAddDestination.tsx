// @libs
import { Button } from 'antd'

// @styles
import styles from './OnboardingTourAddDestination.module.less'
import { EmptyListView } from '@./ui/components/EmptyList/EmptyListView';
import React, { useMemo } from 'react';
import { DropDownList } from '@./ui/components/DropDownList/DropDownList';
import { destinationsReferenceList } from '@./ui/pages/DestinationsPage/commons';
import { Destination } from '@./catalog/destinations/types';

type Props = {
   handleGoNext: () => void;
   handleGoBack: () => void;
 }

export const OnboardingTourAddDestination: React.FC<Props> = function({
  handleGoNext,
  handleGoBack
}) {
  const destinationsDropdownList = useMemo<React.ReactElement<any, string>>(() => (
    <DropDownList
      hideFilter
      list={destinationsReferenceList
        .filter((dst: Destination) => dst.type === 'database')
        .map((dst: Destination) => ({
          title: dst.displayName,
          id: dst.id,
          icon: dst.ui.icon,
          handleClick: () => console.log(dst)
        }))}
    />
  ), []);

  return (
    <div className={styles.mainContainer}>
      <h1 className={styles.header}>
        {'Destinations Setup'}
      </h1>
      <p className={styles.contentText}>
        {`Looks like you don't have destinations set up. Let's create one.`}
      </p>
      <div className={styles.addDestinationButtonContainer}>
        <EmptyListView
          title=""
          list={destinationsDropdownList}
          unit="destination"
          centered={false}
          dropdownOverlayPlacement="bottomCenter"
          showFreeDatabaseSeparateButton={false}
        />
      </div>
      <div className={styles.controlsContainer}>
        <Button type="ghost" className={styles.withButtonsMargins} onClick={handleGoBack}>{'Back'}</Button>
        <Button type="primary" className={styles.withButtonsMargins} onClick={handleGoNext}>{'Next'}</Button>
      </div>
    </div>
  );
}