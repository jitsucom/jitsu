import { fileParameters, filteringExpressionDocumentation, gcsCredentials, tableName } from "./common"
import * as React from "react"
import { ReactNode } from "react"
import { Destination } from "../types"

let icon: ReactNode = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    xmlnsXlink="http://www.w3.org/1999/xlink"
    height="100%"
    width="100%"
    viewBox="-19.20015 -28.483 166.4013 170.898"
  >
    <g transform="translate(0 -7.034)">
      <linearGradient y2="120.789" x2="64" y1="7.034" x1="64" gradientUnits="userSpaceOnUse" id="a">
        <stop offset="0" stopColor="#4387fd" />
        <stop offset="1" stopColor="#4683ea" />
      </linearGradient>
      <path
        d="M27.79 115.217L1.54 69.749a11.499 11.499 0 010-11.499l26.25-45.467a11.5 11.5 0 019.96-5.75h52.5a11.5 11.5 0 019.959 5.75l26.25 45.467a11.499 11.499 0 010 11.5l-26.25 45.466a11.5 11.5 0 01-9.959 5.75h-52.5a11.499 11.499 0 01-9.96-5.75z"
        fill="url(#a)"
      />
    </g>
    <g transform="translate(0 -7.034)">
      <defs>
        <path
          d="M27.791 115.217L1.541 69.749a11.499 11.499 0 010-11.499l26.25-45.467a11.499 11.499 0 019.959-5.75h52.5a11.5 11.5 0 019.96 5.75l26.25 45.467a11.499 11.499 0 010 11.5l-26.25 45.466a11.499 11.499 0 01-9.96 5.75h-52.5a11.499 11.499 0 01-9.959-5.75z"
          id="b"
        />
      </defs>
      <clipPath id="c">
        <use height="100%" width="100%" xlinkHref="#b" overflow="visible" />
      </clipPath>
      <path
        clipPath="url(#c)"
        opacity=".07"
        d="M49.313 53.875l-7.01 6.99 5.957 5.958-5.898 10.476 44.635 44.636 10.816.002L118.936 84 85.489 50.55z"
      />
    </g>
    <path
      d="M84.7 43.236H43.264c-.667 0-1.212.546-1.212 1.214v8.566c0 .666.546 1.212 1.212 1.212H84.7c.667 0 1.213-.546 1.213-1.212v-8.568c0-.666-.545-1.213-1.212-1.213m-6.416 7.976a2.484 2.484 0 01-2.477-2.48 2.475 2.475 0 012.477-2.477c1.37 0 2.48 1.103 2.48 2.477a2.48 2.48 0 01-2.48 2.48m6.415 8.491l-41.436.002c-.667 0-1.212.546-1.212 1.214v8.565c0 .666.546 1.213 1.212 1.213H84.7c.667 0 1.213-.547 1.213-1.213v-8.567c0-.666-.545-1.214-1.212-1.214m-6.416 7.976a2.483 2.483 0 01-2.477-2.48 2.475 2.475 0 012.477-2.477 2.48 2.48 0 110 4.956"
      fill="#fff"
    />
  </svg>
)

const destination: Destination = {
  description: (
    <>
      Google Cloud Storage is ideal for backups and to archive company data. It is a convenient, affordable and
      compliant way to store any amount of static data
    </>
  ),
  syncFromSourcesStatus: "not_supported",
  id: "gcs",
  type: "other",
  displayName: "Google Cloud Storage",
  ui: {
    icon,
    title: (cfg: object) => {
      return cfg["_formData"]["gcsBucket"]
    },
    connectCmd: _ => null,
  },
  parameters: [
    tableName(filteringExpressionDocumentation),
    ...gcsCredentials("_formData.gcsKey", "_formData.gcsBucket"),
    ...fileParameters("_formData.gcsFolder", "_formData.gcsFormat", "_formData.gcsCompressionEnabled"),
  ],
}

export default destination
