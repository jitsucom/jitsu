import { getErrorMessage, getLog, LogLevel, rpc, setGlobalLogLevel } from "juava";
import { AppProps } from "next/app";
import "@fontsource/inter/variable.css";
import "../styles/globals.css";
import { useRouter } from "next/router";
import React, { PropsWithChildren, useEffect, useState } from "react";
import { SessionProvider, signIn, signOut, useSession } from "next-auth/react";
import { GlobalLoader } from "../components/GlobalLoader/GlobalLoader";
import { branding } from "../lib/branding";
import { Alert } from "antd";
import { FiGithub } from "react-icons/fi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AppConfigContextProvider,
  useAppConfig,
  UserContextProvider,
  useUser,
  WorkspaceContextProvider,
} from "../lib/context";
import { AppConfig, ContextApiResponse, SessionUser, StreamConfig } from "../lib/schema";
import Link from "next/link";
import { ErrorBoundary, GlobalError, GlobalOverlay } from "../components/GlobalError/GlobalError";
import { feedbackError, useTitle } from "../lib/ui";
import { getConfigApi, useApi } from "../lib/useApi";
import { AntdTheme } from "../components/AntdTheme/AntdTheme";
import { AntdModalProvider } from "../lib/modal";
import Head from "next/head";
import { JitsuProvider, useJitsu } from "@jitsu/jitsu-react";
import { FirebaseProvider, useFirebaseSession } from "../lib/firebase-client";
import { SignIn } from "../components/SignInOrUp/SignIn";
import { z } from "zod";
import { WorkspaceDbModel } from "../prisma/schema";
import { JitsuButton } from "../components/JitsuButton/JitsuButton";
import { BillingProvider } from "../components/Billing/BillingProvider";
import { ClassicProjectProvider } from "../components/PageLayout/ClassicProjectProvider";

const log = getLog("app");

function getUserFromNextJsSession(session: any): ContextApiResponse["user"] {
  return session && session?.data ? ({ ...session.data, ...session.data?.user } as any) : undefined;
}

function Analytics({ user }: { user?: SessionUser }) {
  const { analytics } = useJitsu();
  const router = useRouter();
  /* eslint-disable react-hooks/exhaustive-deps  */
  //user may be a new object on each render while being the same user
  useEffect(() => {
    //workspace events tracked separately in WorkspacePageLayout
    if (!router.query.workspaceId && user?.internalId) {
      analytics.identify(user.internalId, {
        email: user.email,
        name: user.name,
        loginProvider: user.loginProvider,
        externalId: user.externalId,
      });
    }
  }, [user?.internalId, analytics, router.query.workspaceId]);
  /* eslint-enable */

  useEffect(() => {
    if (!router.query.workspaceId) {
      analytics.page({});
    }
    //workspace page views are tracked separately in WorkspacePageLayout
  }, [router.asPath, analytics, router.query.workspaceId]);
  return <React.Fragment />;
}

const FirebaseAuthorizer: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  const session = useFirebaseSession();
  const [user, setUser] = useState<ContextApiResponse["user"] | null>();
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<any>(undefined);
  const router = useRouter();
  const { analytics } = useJitsu();

  /* eslint-disable react-hooks/exhaustive-deps  */
  //following the rule and adding session to deps will create an
  //endless token refresh cycle
  useEffect(() => {
    const { user, cleanup } = session.resolveUser(router.query.token as string);
    user
      .then(setUser)
      .catch(setAuthError)
      .finally(() => setLoading(false));
    return cleanup;
  }, []);
  /* eslint-enable */

  useEffect(() => {
    if (router.query.projectName) {
      localStorage.setItem("projectName", router.query.projectName as string);
    }
  }, [router.query.projectName]);

  if (loading) {
    return <GlobalLoader title={"Authorizing"} />;
  } else if (authError) {
    return <GlobalError error={authError} title={"Authorization error"} />;
  } else if (user) {
    return (
      <UserContextProvider
        user={user}
        logout={async () => {
          setUser(null);
          await session.signOut();
        }}
      >
        <Analytics user={user} />
        {children}
      </UserContextProvider>
    );
  } else {
    return (
      <>
        <Analytics />
        <SignIn
          engine="firebase"
          variant="signin"
          enablePassword={true}
          onPasswordLogin={async (email, password) => {
            try {
              await session.signIn(email, password);
              const user = await session.resolveUser().user;
              if (!user) {
                feedbackError(`Signin failed`);
                await analytics.track("login_error", { email, type: "password", loginProvider: "firebase/email" });
              } else {
                setUser(user);
                await analytics.track("login", { ...user, type: "password", loginProvider: "firebase/email" });
              }
            } catch (e: any) {
              await analytics.track("login_error", {
                email,
                type: "password",
                loginProvider: "firebase/email",
                message: e?.message || "Unknown error",
              });
              throw e;
            }
          }}
          onSocialLogin={async type => {
            try {
              await session.signInWith(type);
              const user = await session.resolveUser().user;
              if (!user) {
                feedbackError(`Signin failed`);
                await analytics.track("login_error", { type: "social", loginProvider: `firebase/${type}` });
              } else {
                setUser(user);
                await analytics.track("login", { ...user, type: "social", loginProvider: `firebase/${type}` });
              }
            } catch (e: any) {
              await analytics.track("login_error", {
                type: "social",
                loginProvider: `firebase/${type}`,
                message: e?.message || "Unknown error",
              });
              throw e;
            }
          }}
        />
      </>
    );
  }
};

const NextJsAuthorizer: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  const session = useSession();
  if (session && session.data) {
    const user = getUserFromNextJsSession(session);
    return (
      <UserContextProvider user={user} logout={signOut}>
        <Analytics user={user} />
        {children}
      </UserContextProvider>
    );
  } else if (session.status === "loading") {
    return <GlobalLoader title={"Authorizing"} />;
  }
  return (
    <>
      <Analytics />
      <NextJsSigninForm />
    </>
  );
};

function LoginWrapper(props: PropsWithChildren<{ requiresLogin: boolean }>) {
  const appConfig = useAppConfig();
  if (!props.requiresLogin) {
    return (
      <>
        <Analytics />
        {props.children}
      </>
    );
  } else if (appConfig.auth?.firebasePublic) {
    return (
      <FirebaseProvider appConfig={appConfig}>
        <FirebaseAuthorizer>{props.children}</FirebaseAuthorizer>
      </FirebaseProvider>
    );
  } else {
    return <NextJsAuthorizer>{props.children}</NextJsAuthorizer>;
  }
}

const ProgressBar0: React.FC<{ className?: string }> = ({ className }) => {
  const [running, setRunning] = useState(true);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (running) {
      let interval = setInterval(() => {
        setProgress(prev => Math.min(prev + Math.round(Math.random() * 10), 100));
      }, 100);
      return () => clearInterval(interval);
    }
  }, [running]);

  useEffect(() => {
    if (progress === 100) {
      setRunning(false);
    }
  }, [progress]);

  return (
    <div
      style={{ width: `${Math.min(progress, 100)}%`, minWidth: `${Math.min(progress, 100)}%`, color: "white" }}
      className={className}
    />
  );
};

const ProgressBar = React.memo(ProgressBar0);

const LoadingBlur: React.FC<{}> = () => {
  return (
    <div
      className="absolute top-0 flex flex-col left-0 m-0 p-0 z-50  overflow-hidden"
      style={{ height: "100vh", width: "100vw", maxWidth: "100%" }}
    >
      <div>
        <ProgressBar className="bg-primary text-xxs p-0.5" />
      </div>
      <div className="flex justify-center items-center text-primary flex-grow">
        <div className="flex flex-col items-center justify-center">
          <GlobalLoader title="Loading..." />
        </div>
      </div>
    </div>
  );
};

function NextJsSigninForm() {
  const router = useRouter();
  const signup = router.query.signup === "true";
  const appConfig = useAppConfig();
  const signInAndRedirect = async (provider: string) => {
    await signIn(provider);
  };
  return (
    <>
      <div className="w-screen h-screen flex justify-center items-center">
        <div className="flex flex-col items-center justify-center bg-backgroundLight p-8 rounded-xl shadow-lg">
          <h1 className="text-2xl mb-4">{signup ? "Sign Up" : "Sign In"}</h1>
          <JitsuButton
            icon={<FiGithub />}
            type="primary"
            className="w-72 mb-6 "
            size="large"
            onClick={() => signInAndRedirect("github")}
          >
            {signup ? "Sign up" : "Sign in"} in with Github
          </JitsuButton>
          <div className="mt-6 text-textLight">
            {!signup && !appConfig.disableSignup && (
              <>
                Don't have an account?{" "}
                <Link
                  passHref
                  href={{
                    pathname: router.pathname,
                    query: { ...(router.query || {}), signup: true },
                  }}
                  className="font-bold"
                >
                  Sign Up
                </Link>{" "}
                up for free.
              </>
            )}
            {signup && (
              <>
                Already registered?{" "}
                <Link
                  passHref
                  href={{
                    pathname: router.pathname,
                    query: { ...(router.query || {}), signup: false },
                  }}
                  className="font-bold"
                >
                  Sign In
                </Link>
              </>
            )}
          </div>
          {appConfig.credentialsLoginEnabled && (
            <div className="mt-6 text-textLight text-xs">
              <Link passHref href="/api/auth/signin" className="font-bold">
                Sign In with Email
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const queryClient = new QueryClient();

function AppLoader({ children, pageProps }: PropsWithChildren<any>) {
  const { data, isLoading, error } = useApi<AppConfig>(`/api/app-config`);
  const [origin, setOrigin] = useState<string | undefined>();

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  if (isLoading || !data || !origin) {
    return <GlobalLoader title={"Loading application..."} />;
  } else if (error) {
    return <GlobalError error={error} title="Failed to load application config" />;
  }
  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch (e) {
    return <GlobalError error={e} title={`Origin ${origin} is not parseable url`} />;
  }

  if (originUrl.hostname !== data.publicEndpoints.host) {
    getLog()
      .atWarn()
      .log(`Origin ${origin} host ('${originUrl.hostname}') doesn't match public host '${data.publicEndpoints.host}'`);
    return (
      <div className={"h-screen w-screen flex justify-center items-center"}>
        <div>
          Nothing here.{" "}
          <a
            className="underline text-primary"
            href={`${data.publicEndpoints.protocol}://${data.publicEndpoints.host}${
              data.publicEndpoints.port ? `:${data.publicEndpoints.port}` : ""
            }`}
          >
            Open management console
          </a>
        </div>
      </div>
    );
  }

  const trackingHost = data!.telemetry.enabled ? data!.telemetry.host : undefined;
  return (
    <AppConfigContextProvider config={data!}>
      <Head>
        <title>Jitsu</title>
      </Head>
      <JitsuProvider
        options={
          trackingHost
            ? {
                //debug: data?.logLevel === "debug",
                debug: false,
                host: trackingHost,
                echoEvents: !data!.telemetry.host,
                writeKey: data!.telemetry.writeKey,
              }
            : { disabled: true }
        }
      >
        <SessionProvider session={pageProps.session}>
          <LoginWrapper requiresLogin={!pageProps.publicPage}>{children}</LoginWrapper>
        </SessionProvider>
      </JitsuProvider>
    </AppConfigContextProvider>
  );
}

function configureLogging() {
  setGlobalLogLevel((process.env.NEXT_PUBLIC_LOG_LEVEL || "info") as LogLevel);
  if (typeof window !== "undefined") {
    window["jitsu"] = {
      ...(window["jitsu"] || {}),
      setDebugLog: (disable: boolean = false) => setGlobalLogLevel(disable ? "info" : "debug"),
    };
  }
}

const WorkspaceWrapper: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  const router = useRouter();
  if (router.query.workspaceId) {
    return <WorkspaceLoader workspaceId={router.query.workspaceId.toString()}>{children}</WorkspaceLoader>;
  } else {
    return <>{children}</>;
  }
};

const WorkspaceLoader: React.FC<PropsWithChildren<{ workspaceId: string }>> = ({ workspaceId, children }) => {
  const { analytics } = useJitsu();
  const appConfig = useAppConfig();
  const user = useUser();
  const router = useRouter();
  const [streams, setStreams] = useState<StreamConfig[]>([]);

  const {
    data: workspace,
    error,
    isLoading,
  } = useApi<z.infer<typeof WorkspaceDbModel>>(`/api/workspace/${workspaceId}`, {
    outputType: WorkspaceDbModel,
  });

  useEffect(() => {
    (async () => {
      if (workspace?.id) {
        const streams = await getConfigApi<StreamConfig>(workspace.id, "stream").list();
        setStreams(streams);
      }
    })();
  }, [workspace?.id]);

  useEffect(() => {
    (async () => {
      if (workspace?.id && streams.length > 0) {
        try {
          await rpc(`/api/${workspace.id}/ee/s3-init`, {
            method: "POST",
            query: { workspaceId: workspace.id },
          });
        } catch (e: any) {
          console.error("Failed to init S3 bucket", e.message);
        }
      }
    })();
  }, [workspace?.id, streams]);

  useEffect(() => {
    if (workspace?.id) {
      analytics.page("Workspace Page", {
        context: { workspaceId: workspace.id, groupId: workspace.id },
      });
    } else if (error) {
      analytics.track("error", { location: "WorkspacePageLayout", errorMessage: getErrorMessage(error) });
    }
  }, [analytics, router.asPath, workspace?.id, error]);

  /* eslint-disable react-hooks/exhaustive-deps  */
  //user may be a new object on each render while being the same user
  useEffect(() => {
    if (workspace?.id && user?.internalId) {
      analytics.identify(user.internalId, {
        email: user.email,
        name: user.name,
        loginProvider: user.loginProvider,
        externalId: user.externalId,
        groupId: workspace.id,
      });
    }
  }, [user?.internalId, analytics, workspace?.id]);

  useEffect(() => {
    if (workspace?.id) {
      analytics.group(workspace.id, {
        name: workspace.name,
        slug: workspace.slug ?? "",
        createdAt: workspace.createdAt.toISOString(),
      });
    }
  }, [analytics, workspace?.id, workspace?.name, workspace?.slug]);
  /* eslint-enable */

  if (error) {
    log.atError().log(`Can't load workspace ${JSON.stringify(error)}`, error);
    return (
      <GlobalOverlay>
        <div className="md:scale-125 mt-4 mx-4">
          <Alert
            type="info"
            showIcon
            message={<b>Can't access workspace</b>}
            description={
              <div className="">
                <div className="max-w-1xl">
                  The workspace <b>{router.query.workspaceId}</b> is not available or you don't have access to it. If
                  you sure that it exists, please contact the owner.
                </div>
                <JitsuButton href="/workspaces" className="mt-4">
                  Go to available workspaces
                </JitsuButton>
              </div>
            }
          />
        </div>
      </GlobalOverlay>
    );
  } else if (isLoading) {
    return <GlobalLoader title={isLoading ? "Loading workspace data..." : "Loading user data..."} />;
  } else {
    return (
      <WorkspaceContextProvider workspace={{ ...workspace, slugOrId: workspace?.slug || workspace?.id }}>
        <BillingProvider sendAnalytics={true} enabled={appConfig.billingEnabled}>
          <ClassicProjectProvider>{children}</ClassicProjectProvider>
        </BillingProvider>
      </WorkspaceContextProvider>
    );
  }
};
export const App = ({ Component, pageProps }: AppProps) => {
  useTitle(branding.productName);
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const startLoader = (url: string, { shallow }: { shallow?: boolean }) => {
    if (!shallow) {
      setLoading(true);
    }
  };
  const hideLoader = (url: string, { shallow }: { shallow?: boolean }) => {
    if (!shallow) {
      setLoading(false);
    }
  };
  useEffect(() => {
    configureLogging();
    router.events.on("routeChangeStart", startLoader);
    router.events.on("routeChangeComplete", hideLoader);
    router.events.on("routeChangeError", hideLoader);
  }, [router.events]);

  return (
    <AntdTheme>
      <Head>
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#5bbad5" />
      </Head>
      <AntdModalProvider>
        {loading && <LoadingBlur />}
        <div className={`global-wrapper`}>
          <ErrorBoundary renderError={props => <GlobalError error={props.error} title="System error" />}>
            <QueryClientProvider client={queryClient}>
              <AppLoader pageProps={pageProps}>
                <WorkspaceWrapper>
                  <Component {...pageProps} />
                </WorkspaceWrapper>
              </AppLoader>
            </QueryClientProvider>
          </ErrorBoundary>
        </div>
      </AntdModalProvider>
    </AntdTheme>
  );
};

export default App;
