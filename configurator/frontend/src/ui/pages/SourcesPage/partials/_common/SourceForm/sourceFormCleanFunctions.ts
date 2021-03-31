import { naturalSort } from '@util/Array';

const sourceFormCleanFunctions = {
  getUniqueAutoIncremented: (alreadyExists: string[], blank: string, separator: string = '_') => {
    if (!alreadyExists.some(someValue => blank === someValue)) {
      return blank;
    }

    const maxIndex = naturalSort(alreadyExists)?.pop()

    if (!maxIndex) {
      return blank;
    }

    const divided = maxIndex.split(separator);

    let tail = parseInt(divided[divided.length - 1]);

    if (isNaN(tail)) {
      divided[divided.length] = '1';
    } else {
      tail++;
      divided[divided.length - 1] = tail;
    }

    return divided.join('_');
  }
};

export { sourceFormCleanFunctions };
