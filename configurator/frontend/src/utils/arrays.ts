import { isArray } from './typeCheck';

export const naturalSort = (array: string[]): string[] => {
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base'
  });

  return array.sort(collator.compare);
};

/**
 * Converts argument to array of a single value if it is not already an array
 * @param arg - value to convert
 * @returns array
 */
export const toArrayIfNot = <T>(arg: T | T[]): T[] => {
  return isArray(arg) ? arg : [arg];
};

/**
 * Adds value to array if it is not already there. Uses SameValueZero comparison.
 * @param array array to add value to
 * @param value value to add
 * @returns a copy of initial array with an added value, or an array without modification
 */
export const addToArrayIfNotDuplicate = <T>(array: T[], value: T): T[] => {
  return array.some((item) => item === value) ? [...array] : [...array, value];
};

// /**
//  * Deletes all occurences of values from an array.
//  * @param array to delete values from
//  * @param valuesToDelete - a value or an array of values to delete
//  * @returns a new array with deleted values.
//  */
// export const removeAllFromArrayByValue = <T>(array: T[], valuesToDelete: T | T[]): T[] => {
//   const listOfValuesToDelete = toArrayIfNot(valuesToDelete);
//   return array.filter(value => !listOfValuesToDelete.find(valueToDelete => valueToDelete === value));
// }

// /**
//  * Deletes the first occurence of values from an array.
//  * @param array to delete values from
//  * @param valuesToDelete - a value or an array of values to delete
//  * @returns a new array with deleted values.
//  */
//  export const removeFromArrayByValue = <T>(array: T[], valuesToDelete: T | T[]): T[] => {
//   let listOfValuesToDelete = toArrayIfNot(valuesToDelete);
//   return array.filter(value => {
//     const needToDelete = !listOfValuesToDelete.find(valueToDelete => valueToDelete === value);
//     if (needToDelete) listOfValuesToDelete = removeAllFromArrayByValue(listOfValuesToDelete, value);
//     return !needToDelete;
//   });
// }
