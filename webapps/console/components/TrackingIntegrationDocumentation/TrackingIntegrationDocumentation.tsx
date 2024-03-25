import { Overlay } from "../Overlay/Overlay";
import { Dropdown, Tabs } from "antd";
import { useConfigApi } from "../../lib/useApi";
import { useQuery } from "@tanstack/react-query";
import { StreamConfig } from "../../lib/schema";
import { LoadingAnimation } from "../GlobalLoader/GlobalLoader";
import { ErrorCard } from "../GlobalError/GlobalError";
import { Center } from "../Center/Center";
import { HtmlManual } from "./Html";
import { ReactManual } from "./React";
import { useURLPersistedState } from "../../lib/ui";
import { ButtonLabel } from "../ButtonLabel/ButtonLabel";
import { FiMonitor } from "react-icons/fi";
import { FaGlobe, FaNodeJs, FaReact } from "react-icons/fa";
import { NPMManual } from "./NPMPackage";
import { Other } from "./Other";
import { useAppConfig } from "../../lib/context";
import { ReactNode, useState } from "react";
import { HiSelector } from "react-icons/hi";
import { HTTPManual } from "./HTTPApi";
import { Plug } from "lucide-react";

function SegmentLogo() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 64 64">
      <g transform="matrix(.768307 0 0 .768307 0 2.304922)">
        <path d="M51.9 52.8H4c-2.2 0-4-1.8-4-4s1.8-4 4-4h47.9c2.2 0 4 1.8 4 4s-1.8 4-4 4z" fill="#99cfac" />
        <path
          d="M41.7 77.3c-3.9 0-7.8-.6-11.5-1.7-2.1-.7-3.3-2.9-2.6-5s2.9-3.3 5-2.6c2.9.9 6 1.4 9.1 1.4 13.6 0 25.4-8.7 29.3-21.7.6-2.1 2.9-3.3 5-2.7s3.3 2.9 2.7 5c-5.1 16.3-19.9 27.3-37 27.3z"
          fill="#49b881"
        />
        <path d="M79.3 32.5H31.4c-2.2 0-4-1.8-4-4s1.8-4 4-4h47.9c2.2 0 4 1.8 4 4s-1.8 4-4 4z" fill="#99cfac" />
        <path
          d="M8.5 32.5c-.4 0-.8-.1-1.2-.2-2.1-.6-3.3-2.9-2.7-5C9.7 11 24.5 0 41.7 0c3.9 0 7.8.6 11.5 1.7 2.1.7 3.3 2.9 2.6 5s-2.9 3.3-5 2.6c-2.9-.9-6-1.4-9.1-1.4-13.6 0-25.4 8.7-29.3 21.7-.6 1.8-2.2 2.9-3.9 2.9z"
          fill="#49b881"
        />
        <g fill="#99cfac">
          <circle r="4" cy="13.3" cx="65.4" />
          <circle r="4" cy="64.1" cx="17.9" />
        </g>
      </g>
    </svg>
  );
}

export const DomainSelector: React.FC<{
  domains: string[];
  domain: string;
  onChange: (domain: string) => void;
}> = props => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  return (
    <div className="flex items-center space-x-1">
      <code>{props.domain}</code>
      <Dropdown
        open={dropdownOpen}
        trigger={["click"]}
        placement="bottomRight"
        arrow
        dropdownRender={() => (
          <div className="shadow px-4 py-4 bg-backgroundLight">
            {props.domains.map(d => (
              <div
                key={d}
                className="pb-2 cursor-pointer flex items-center"
                onClick={() => {
                  props.onChange(d);
                  setDropdownOpen(false);
                }}
              >
                <div className="w-4">{d === props.domain ? "→" : " "}</div>
                <code>{d}</code>
              </div>
            ))}
          </div>
        )}
      >
        <div className="cursor-pointer" onClick={() => setDropdownOpen(!dropdownOpen)}>
          <HiSelector />
        </div>
      </Dropdown>
    </div>
  );
};

export const TrackingIntegrationDocumentation: React.FC<{ streamId: string; onCancel: () => void }> = ({
  streamId,
  onCancel,
}) => {
  const appConfig = useAppConfig();
  const configApi = useConfigApi<StreamConfig>("stream");
  const [selectedDomain, setSelectedDomain] = useState<string | undefined>();
  const {
    data: stream,
    isLoading,
    error,
  } = useQuery(["stream", streamId], () => configApi.get(streamId), { cacheTime: 0, retry: false });
  const [framework, setFramework] = useURLPersistedState("framework", {
    defaultVal: "html",
    parser: v => v,
    serializer: v => v,
  });
  let domains: string[] = [];
  let protocol = appConfig.publicEndpoints.protocol;
  if (appConfig.publicEndpoints.ingestUrl) {
    //extract host and port
    try {
      const url = new URL(appConfig.publicEndpoints.ingestUrl);
      const host = url.host;
      protocol = url.protocol === "https:" ? "https" : "http";
      domains.push(host);
    } catch (e) {
      console.error("Can't parse ingest URL", appConfig.publicEndpoints.ingestUrl);
    }
  } else {
    domains = stream
      ? appConfig.publicEndpoints.dataHost || appConfig.ee.available
        ? [...(stream?.domains ?? []), `${stream.id}.${appConfig.publicEndpoints.dataHost}`]
        : ["{deploy domain}"]
      : [];
  }
  const writeKey =
    appConfig.publicEndpoints.dataHost || appConfig.ee.available
      ? undefined
      : stream?.publicKeys?.[0]
      ? `${stream.publicKeys[0].id}:${stream.publicKeys[0].hint}`
      : streamId || "{write-key}";
  const serverWriteKey = stream?.privateKeys?.[0]
    ? `${stream.privateKeys[0].id}:${stream.privateKeys[0].hint}`
    : "{server-write-key}";
  const displayDomain = `${protocol}://${selectedDomain ?? domains?.[0]}`;
  const wrap = (r: ReactNode) => {
    return (
      <div className="relative">
        <div className="absolute w-full flex justify-center">
          <div className="max-w-6xl w-full flex justify-end">
            {(appConfig.ee.available || appConfig.publicEndpoints.dataHost) && (
              <DomainSelector domains={domains} domain={selectedDomain ?? domains?.[0]} onChange={setSelectedDomain} />
            )}
          </div>
        </div>
        <div>{r}</div>
      </div>
    );
  };
  return (
    <>
      <Overlay onClose={onCancel} className="px-6 py-6">
        <div style={{ minWidth: 900 }}>
          <>
            {isLoading && (
              <Center vertical={true} horizontal={true}>
                <LoadingAnimation />
              </Center>
            )}
            {error && (
              <Center vertical={true} horizontal={true}>
                <ErrorCard error={error} />
              </Center>
            )}
            {stream && (
              <Tabs
                defaultActiveKey={framework}
                onChange={setFramework}
                items={[
                  {
                    label: (
                      <ButtonLabel className="text-lg" icon={<FiMonitor className="w-5 h-5" />}>
                        HTML
                      </ButtonLabel>
                    ),
                    key: "html",
                    children: wrap(<HtmlManual domain={displayDomain} writeKey={writeKey || undefined} />),
                  },
                  {
                    label: (
                      <ButtonLabel className="text-lg" icon={<FaReact className="w-5 h-5" />}>
                        React
                      </ButtonLabel>
                    ),
                    key: "react",
                    children: wrap(<ReactManual domain={displayDomain} writeKey={writeKey || undefined} />),
                  },
                  {
                    label: (
                      <ButtonLabel className="text-lg" icon={<FaNodeJs className="w-5 h-5" />}>
                        NPM Package
                      </ButtonLabel>
                    ),
                    key: "js",
                    children: wrap(<NPMManual domain={displayDomain} writeKey={writeKey || undefined} />),
                  },
                  {
                    label: (
                      <ButtonLabel className="text-lg" icon={<FaGlobe className="w-5 h-5" />}>
                        HTTP API
                      </ButtonLabel>
                    ),
                    key: "http",
                    children: wrap(<HTTPManual domain={displayDomain} writeKey={serverWriteKey || undefined} />),
                  },
                  {
                    label: (
                      <ButtonLabel className="text-lg" icon={<Plug className="w-5 h-5" />}>
                        Others
                      </ButtonLabel>
                    ),
                    key: "other",
                    children: wrap(<Other domain={displayDomain} />),
                  },
                ]}
              />
            )}
          </>
        </div>
      </Overlay>
    </>
  );
};
