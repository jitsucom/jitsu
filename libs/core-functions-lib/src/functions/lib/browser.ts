type ParsedUserAgent = { name: string; deviceType: string; os: string; browserVersion: number | undefined };

export function parseUserAgentLegacy(userAgent: string, vendor: string | undefined): ParsedUserAgent {
  return {
    name: browser(userAgent, vendor),
    deviceType: device(userAgent),
    os: os(userAgent),
    browserVersion: browserVersion(userAgent, vendor),
  };
}

function includes(haystack: string, needle: string): boolean {
  return haystack.indexOf(needle) >= 0;
}

function browser(userAgent: string, vendor: string | undefined): string {
  vendor = vendor || ""; // vendor is undefined for at least IE9
  if (includes(userAgent, " OPR/")) {
    if (includes(userAgent, "Mini")) {
      return "Opera Mini";
    }
    return "Opera";
  } else if (/(BlackBerry|PlayBook|BB10)/i.test(userAgent)) {
    return "BlackBerry";
  } else if (includes(userAgent, "IEMobile") || includes(userAgent, "WPDesktop")) {
    return "Internet Explorer Mobile";
  } else if (includes(userAgent, "SamsungBrowser/")) {
    // https://developer.samsung.com/internet/user-agent-string-format
    return "Samsung Internet";
  } else if (includes(userAgent, "Edge") || includes(userAgent, "Edg/")) {
    return "Microsoft Edge";
  } else if (includes(userAgent, "FBIOS")) {
    return "Facebook Mobile";
  } else if (includes(userAgent, "Chrome")) {
    return "Chrome";
  } else if (includes(userAgent, "CriOS")) {
    return "Chrome iOS";
  } else if (includes(userAgent, "UCWEB") || includes(userAgent, "UCBrowser")) {
    return "UC Browser";
  } else if (includes(userAgent, "FxiOS")) {
    return "Firefox iOS";
  } else if (includes(vendor, "Apple")) {
    if (includes(userAgent, "Mobile")) {
      return "Mobile Safari";
    }
    return "Safari";
  } else if (includes(userAgent, "Android")) {
    return "Android Mobile";
  } else if (includes(userAgent, "Konqueror")) {
    return "Konqueror";
  } else if (includes(userAgent, "Firefox")) {
    return "Firefox";
  } else if (includes(userAgent, "MSIE") || includes(userAgent, "Trident/")) {
    return "Internet Explorer";
  } else if (includes(userAgent, "Gecko")) {
    return "Mozilla";
  } else {
    return "";
  }
}

function browserVersion(userAgent: string, vendor: string | undefined): number | undefined {
  const regexList = {
    "Internet Explorer Mobile": /rv:(\d+(\.\d+)?)/,
    "Microsoft Edge": /Edge?\/(\d+(\.\d+)?)/,
    Chrome: /Chrome\/(\d+(\.\d+)?)/,
    "Chrome iOS": /CriOS\/(\d+(\.\d+)?)/,
    "UC Browser": /(UCBrowser|UCWEB)\/(\d+(\.\d+)?)/,
    Safari: /Version\/(\d+(\.\d+)?)/,
    "Mobile Safari": /Version\/(\d+(\.\d+)?)/,
    Opera: /(Opera|OPR)\/(\d+(\.\d+)?)/,
    Firefox: /Firefox\/(\d+(\.\d+)?)/,
    "Firefox iOS": /FxiOS\/(\d+(\.\d+)?)/,
    Konqueror: /Konqueror:(\d+(\.\d+)?)/,
    BlackBerry: /BlackBerry (\d+(\.\d+)?)/,
    "Android Mobile": /android\s(\d+(\.\d+)?)/,
    "Samsung Internet": /SamsungBrowser\/(\d+(\.\d+)?)/,
    "Internet Explorer": /(rv:|MSIE )(\d+(\.\d+)?)/,
    Mozilla: /rv:(\d+(\.\d+)?)/,
  };

  const browserString = browser(userAgent, vendor) as keyof typeof regexList;
  const regex: RegExp = regexList[browserString] || undefined;

  if (regex === undefined) {
    return undefined;
  }
  const matches = userAgent.match(regex);
  if (!matches) {
    return undefined;
  }
  return parseFloat(matches[matches.length - 2]);
}

function os(a: string): string {
  if (/Windows/i.test(a)) {
    if (/Phone/.test(a) || /WPDesktop/.test(a)) {
      return "Windows Phone";
    }
    return "Windows";
  } else if (/(iPhone|iPad|iPod)/.test(a)) {
    return "iOS";
  } else if (/Android/.test(a)) {
    return "Android";
  } else if (/(BlackBerry|PlayBook|BB10)/i.test(a)) {
    return "BlackBerry";
  } else if (/Mac/i.test(a)) {
    return "Mac OS X";
  } else if (/Linux/.test(a)) {
    return "Linux";
  } else if (/CrOS/.test(a)) {
    return "Chrome OS";
  } else {
    return "";
  }
}

function device(userAgent: string): string {
  if (/Windows Phone/i.test(userAgent) || /WPDesktop/.test(userAgent)) {
    return "Windows Phone";
  } else if (/iPad/.test(userAgent)) {
    return "iPad";
  } else if (/iPod/.test(userAgent)) {
    return "iPod Touch";
  } else if (/iPhone/.test(userAgent)) {
    return "iPhone";
  } else if (/(BlackBerry|PlayBook|BB10)/i.test(userAgent)) {
    return "BlackBerry";
  } else if (/Android/.test(userAgent)) {
    return "Android";
  } else {
    return "";
  }
}
