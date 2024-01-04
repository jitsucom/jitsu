import { getErrorMessage, getLog, LogLevel, rpc, setGlobalLogLevel } from "juava";
import { AppProps } from "next/app";
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
  useWorkspace,
  WorkspaceContextProvider,
} from "../lib/context";
import { AppConfig, ContextApiResponse, SessionUser } from "../lib/schema";
import Link from "next/link";
import { ErrorBoundary, GlobalError, GlobalOverlay } from "../components/GlobalError/GlobalError";
import { feedbackError, useTitle } from "../lib/ui";
import { useApi } from "../lib/useApi";
import { AntdTheme } from "../components/AntdTheme/AntdTheme";
import { AntdModalProvider } from "../lib/modal";
import Head from "next/head";
import { JitsuProvider, useJitsu } from "@jitsu/jitsu-react";
import { FirebaseProvider, useFirebaseSession } from "../lib/firebase-client";
import { SignIn } from "../components/SignInOrUp/SignIn";
import { JitsuButton } from "../components/JitsuButton/JitsuButton";
import { BillingProvider } from "../components/Billing/BillingProvider";
import { ClassicProjectProvider } from "../components/PageLayout/ClassicProjectProvider";
import { useConfigObjectList, useConfigObjectsUpdater, useLoadedWorkspace } from "../lib/store";

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
                await analytics.track("login_error", {
                  traits: { email, type: "password", loginProvider: "firebase/email" },
                });
              } else {
                setUser(user);
                await analytics.track("login", {
                  traits: { ...user, type: "password", loginProvider: "firebase/email" },
                });
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
                await analytics.track("login_error", { traits: { type: "social", loginProvider: `firebase/${type}` } });
              } else {
                setUser(user);
                await analytics.track("login", {
                  traits: { ...user, type: "social", loginProvider: `firebase/${type}` },
                });
              }
            } catch (e: any) {
              await analytics.track("login_error", {
                type: "social",
                loginProvider: `firebase/${type}`,
                message: e?.message || "Unknown error",
                details: e?.stack || undefined,
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
  const [showAnimation, setShowAnimation] = useState(false);
  useEffect(() => {
    setTimeout(() => setShowAnimation(true), 1000);
  }, []);
  return (
    <div
      className="absolute top-0 flex flex-col left-0 m-0 p-0 overflow-hidden"
      style={{ height: "100vh", width: "100vw", maxWidth: "100%" }}
    >
      <div className={"z-50"}>
        <ProgressBar className="bg-primary text-xxs p-0.5" />
      </div>
      <div
        className={`flex justify-center items-center text-primary flex-auto relative z-40 ${
          showAnimation ? "backdrop-blur" : ""
        }`}
      >
        <div className="flex flex-col items-center justify-center">
          <GlobalLoader title="Loading page..." />
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
            {signup ? "Sign up" : "Sign in"} with Github
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
if (typeof window !== "undefined") {
  window["queryClient"] = queryClient;
}

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

  const trackingHost = data!.frontendTelemetry.enabled ? data!.frontendTelemetry.host : undefined;
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

const StoreLoader: React.FC<
  PropsWithChildren<{
    workspaceIdOrSlug: string;
  }>
> = ({ workspaceIdOrSlug, children }) => {
  const configObjectsUpdater = useConfigObjectsUpdater(workspaceIdOrSlug);
  if (configObjectsUpdater.error) {
    log
      .atError()
      .log(`Can't load workspace ${JSON.stringify(configObjectsUpdater.error, null, 2)}`, configObjectsUpdater.error);
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
                  The workspace <b>{workspaceIdOrSlug}</b> is not available or you don't have access to it. If you sure
                  that it exists, please contact the owner.
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
  } else if (configObjectsUpdater.loading) {
    return <GlobalLoader title={"Loading workspace data..."} />;
  } else {
    return <>{children}</>;
  }
};

const WorkspaceWrapper: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  const router = useRouter();
  if (router.query.workspaceId) {
    return (
      <StoreLoader workspaceIdOrSlug={router.query.workspaceId.toString()}>
        <WorkspaceLoader workspaceIdOrSlug={router.query.workspaceId.toString()}>{children}</WorkspaceLoader>
      </StoreLoader>
    );
  } else {
    return <>{children}</>;
  }
};

/**
 * We need to get rid of this, and move this to the backend completely.
 *
 * We should actually use this component somewhere in the app
 * @constructor
 */
export const S3BucketInitializer: React.FC<{}> = () => {
  const appConfig = useAppConfig();
  const workspace = useWorkspace();
  const streams = useConfigObjectList("stream");
  useEffect(() => {
    (async () => {
      if (appConfig.ee.available && workspace?.id && streams.length > 0) {
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
  }, [workspace?.id, streams, appConfig]);
  return <></>;
};

const WorkspaceLoader: React.FC<
  PropsWithChildren<{
    workspaceIdOrSlug: string;
  }>
> = ({ workspaceIdOrSlug, children }) => {
  const { analytics } = useJitsu();
  const appConfig = useAppConfig();
  const user = useUser();
  const router = useRouter();

  const workspace = useLoadedWorkspace(workspaceIdOrSlug);

  const configObjectsUpdater = useConfigObjectsUpdater(workspaceIdOrSlug);

  useEffect(() => {
    if (workspace?.id) {
      analytics.page("Workspace Page", {
        context: { workspaceId: workspace.id, groupId: workspace.id },
      });
    } else if (configObjectsUpdater.error) {
      analytics.track("error", {
        location: "WorkspacePageLayout",
        errorMessage: getErrorMessage(configObjectsUpdater.error),
      });
    }
  }, [analytics, router.asPath, workspace?.id, configObjectsUpdater.error]);

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
      console.log("Sending page view of workspace", workspace);
      analytics.group(workspace.id, {
        name: workspace.name,
        slug: workspace.slug ?? "",
        createdAt: workspace.createdAt.toISOString(),
      });
    }
  }, [analytics, workspace?.id, workspace?.name, workspace?.slug]);
  /* eslint-enable */

  return (
    <WorkspaceContextProvider workspace={{ ...workspace, slugOrId: workspace?.slug || workspace?.id }}>
      <BillingProvider sendAnalytics={true} enabled={appConfig.billingEnabled}>
        <ClassicProjectProvider>{children}</ClassicProjectProvider>
      </BillingProvider>
    </WorkspaceContextProvider>
  );
};

export const ReadOnlyBanner: React.FC<{}> = () => {
  const appConfig = useAppConfig();
  if (appConfig.readOnlyUntil) {
    return (
      <div className="px-4 py-2 text-center bg-warning/20 border-b border-warning">
        Jitsu is in a read-only maintenance mode until{" "}
        <b>{new Date(appConfig.readOnlyUntil).toISOString().split(".")[0].replace("T", " ")} UTC</b>. Your data is being
        processed as usual, but you can't change the configuration.
      </div>
    );
  }
  return <></>;
};

export const App = ({ Component, pageProps }: AppProps) => {
  useTitle(branding.productName);
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const startLoader = (url: string, en?: { shallow?: boolean }) => {
    if (!en?.shallow) {
      setLoading(true);
    }
  };
  const hideLoader = (url: string, en?: { shallow?: boolean }) => {
    if (!en?.shallow) {
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
                <ReadOnlyBanner />
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
