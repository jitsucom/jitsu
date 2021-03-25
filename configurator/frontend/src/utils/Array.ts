function naturalSort(array) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  return array.sort(collator.compare);
}

export { naturalSort };
