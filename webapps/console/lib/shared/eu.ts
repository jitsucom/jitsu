const _euCountryCodes = [
  "AT", // Austria
  "BE", // Belgium
  "BG", // Bulgaria
  "CY", // Cyprus
  "CZ", // Czech Republic
  "DE", // Germany
  "DK", // Denmark
  "EE", // Estonia
  "ES", // Spain
  "FI", // Finland
  "FR", // France
  "GR", // Greece
  "HR", // Croatia
  "HU", // Hungary
  "IE", // Ireland
  "IT", // Italy
  "LT", // Lithuania
  "LU", // Luxembourg
  "LV", // Latvia
  "MT", // Malta
  "NL", // Netherlands
  "PL", // Poland
  "PT", // Portugal
  "RO", // Romania
  "SE", // Sweden
  "SI", // Slovenia
  "SK", // Slovakia
];

export const euCountryCodes = new Set(_euCountryCodes);

export function isEU(countryCode: string): boolean {
  return euCountryCodes.has(countryCode.toUpperCase());
}
