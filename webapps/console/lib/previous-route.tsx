import { useRouter } from "next/router";
import { useEffect, useRef, useState, createContext, FC, useContext } from "react";

const PreviousRouteContext = createContext<string | null>(null);

export const PreviousRouteContextProvider: FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const [previousRoute, setPreviousRoute] = useState<string | null>(null);
  const routeRef = useRef<string>(router.asPath);

  useEffect(() => {
    const handleRouteChange = (url: string) => {
      setPreviousRoute(routeRef.current);
      routeRef.current = url;
    };

    router.events.on("routeChangeStart", handleRouteChange);
    return () => {
      router.events.off("routeChangeStart", handleRouteChange);
    };
  }, [router]);

  return <PreviousRouteContext.Provider value={previousRoute}>{children}</PreviousRouteContext.Provider>;
};

export function usePreviousRoute() {
  return useContext(PreviousRouteContext);
}
