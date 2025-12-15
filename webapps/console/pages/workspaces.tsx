import { useRouter } from "next/router";
import { FaArrowLeft, FaPlus } from "react-icons/fa";
import { get } from "../lib/useApi";
import { z } from "zod";
import { WorkspaceDbModel } from "../prisma/schema";
import { ArrowRight, Loader2, CheckCircle, XCircle, Mail } from "lucide-react";
import { EmbeddedErrorMessage } from "../components/GlobalError/GlobalError";
import { getLog } from "juava";
import Link from "next/link";
import React, { useState, useMemo, useRef, useEffect } from "react";
import { feedbackError, feedbackSuccess } from "../lib/ui";
import { JitsuButton } from "../components/JitsuButton/JitsuButton";
import { Input, Tag, Button, Skeleton } from "antd";
import { useQueryStringState } from "../lib/useQueryStringState";
import { branding } from "../lib/branding";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import { useUserSessionControls } from "../lib/context";

const log = getLog("worspaces");

// Header component with title and subtitle
const WorkspaceHeader: React.FC<{ subtitle?: string }> = ({ subtitle }) => (
  <div className="text-center pt-6 pb-4">
    <h1 className="text-2xl mb-2">👋 Select workspace</h1>
    {subtitle && <p className="text-lg text-textLight">{subtitle}</p>}
  </div>
);

// Loading skeleton component
const WorkspaceLoadingSkeleton: React.FC = () => (
  <>
    {Array(6)
      .fill(0)
      .map((_, index) => (
        <div key={index} className="border border-textDisabled rounded px-4 py-4">
          <Skeleton
            active
            paragraph={{
              rows: 1,
              width: "100%",
            }}
            title={{ width: "60%" }}
          />
        </div>
      ))}
  </>
);

// Individual workspace card component
const WorkspaceCard: React.FC<{
  workspace: any;
  userData: any;
}> = ({ workspace, userData }) => (
  <Link
    className="border border-textDisabled rounded px-4 py-4 shadow hover:border-primaryDark hover:shadow-primaryLighter flex justify-between items-center hover:text-textPrimary group"
    key={workspace.slug || workspace.id}
    href={`/${workspace.slug || workspace.id}`}
  >
    <div className="flex items-center justify-start gap-2">
      <div>{workspace.name || workspace.slug || workspace.id}</div>
      <div className="text-textLight">/{workspace.slug || workspace.id}</div>
      <Tag className="text-xs text-textLight">{workspace.id}</Tag>
      {!workspace.slug && (
        <Tag color="lime" className="text-xs text-textLight">
          Not configured
        </Tag>
      )}
      {userData?.admin && workspace["entities"] > 0 && (
        <Tag color="blue" className="text-xs text-textLight">
          objects: {workspace["entities"]}
        </Tag>
      )}
      {userData?.admin && workspace["active"] && (
        <Tag color="green-inverse" className="text-xs text-textLight">
          active
        </Tag>
      )}
    </div>
    <div className="invisible group-hover:visible">
      <ArrowRight className="text-primary" />
    </div>
  </Link>
);

const WorkspacesList = () => {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useQueryStringState("filter", {
    defaultValue: "",
    skipHistory: true,
  });
  const [debouncedSearch] = useDebounce(searchQuery, 500);
  const searchInputRef = useRef<any>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // First, get initial data to check total count
  const {
    data: infiniteData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useInfiniteQuery(
    ["workspaces", debouncedSearch],
    async ({ pageParam = 0 }) => {
      const params = new URLSearchParams({
        page: pageParam.toString(),
        limit: "100",
      });
      if (debouncedSearch) {
        params.append("search", debouncedSearch);
      }

      const response = await get(`/api/workspace?${params.toString()}`);
      return response as {
        workspaces: z.infer<typeof WorkspaceDbModel>[];
        pagination: {
          page: number;
          limit: number;
          totalCount: number;
          hasMore: boolean;
        };
      };
    },
    {
      getNextPageParam: lastPage => (lastPage.pagination.hasMore ? lastPage.pagination.page + 1 : undefined),
    }
  );

  // Get user data for admin features
  const { data: userData } = useQuery({
    queryKey: ["user-properties"],
    queryFn: async () => await get(`/api/user/properties`),
  });

  const allWorkspaces = useMemo(() => {
    return infiniteData?.pages.flatMap(page => page.workspaces) || [];
  }, [infiniteData]);

  const totalCount = infiniteData?.pages[0]?.pagination.totalCount || 0;

  // Keep track of the total count to prevent it from disappearing during search loading
  const [cachedTotalCount, setCachedTotalCount] = useState(0);

  // Update stable count only when we have actual data
  useEffect(() => {
    if (totalCount > 0) {
      setCachedTotalCount(totalCount);
    }
  }, [totalCount]);

  const displayCount = cachedTotalCount > 0 ? cachedTotalCount : totalCount;
  const hasActiveSearch = Boolean(debouncedSearch);
  const hasResults = allWorkspaces.length > 0;

  // Auto-focus search input when page loads and when results are displayed
  useEffect(() => {
    if (!isLoading && searchInputRef.current) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isLoading, hasResults]);

  // Auto-load more content when scroll reaches the bottom
  useEffect(() => {
    const loadMoreElement = loadMoreRef.current;
    if (!loadMoreElement || !hasNextPage || hasActiveSearch || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      entries => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          fetchNextPage();
        }
      },
      {
        threshold: 0.1,
        rootMargin: "100px", // Start loading 100px before reaching the element
      }
    );

    observer.observe(loadMoreElement);

    return () => {
      observer.unobserve(loadMoreElement);
    };
  }, [hasNextPage, hasActiveSearch, isFetchingNextPage, fetchNextPage]);

  // Initial loading state (no data yet)
  if (isLoading) {
    return (
      <>
        <WorkspaceHeader subtitle="Loading workspaces..." />
        <div className="flex flex-col space-y-4 w-full mx-auto">
          <div>
            <Input
              ref={searchInputRef}
              allowClear
              placeholder="Search workspaces..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full border border-textDisabled rounded-lg px-4 py-4"
              disabled={true}
            />
          </div>
          <WorkspaceLoadingSkeleton />
        </div>
      </>
    );
  }

  // Error state
  if (error) {
    log.atError().withCause(error).log("Failed to load workspaces list");
    return (
      <div className="flex justify-center items-center h-full">
        <EmbeddedErrorMessage>Failed to load workspaces list</EmbeddedErrorMessage>
      </div>
    );
  }

  // No workspaces at all (empty account)
  if (displayCount === 0 && !isLoading) {
    return (
      <div className="flex flex-col gap-5 items-center h-full mb-6 mt-12">
        <div className="text-2xl flex items-center justify-center gap-2">
          <span className="w-5 h-5 inline-block">{branding.logo}</span> No active workspaces
        </div>
        <JitsuButton
          size="large"
          type="primary"
          onClick={async () => {
            await router.push("/new-workspace");
          }}
        >
          Create New Workspace
        </JitsuButton>
      </div>
    );
  }

  // Main workspace list view
  return (
    <>
      <WorkspaceHeader
        subtitle={
          displayCount > 10
            ? `${displayCount.toLocaleString()} workspace${displayCount === 1 ? "" : "s"} available`
            : undefined
        }
      />
      <div className="flex flex-col space-y-4 w-full mx-auto">
        <div>
          <Input
            ref={searchInputRef}
            allowClear
            placeholder="Search workspaces..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full border border-textDisabled rounded-lg px-4 py-4"
          />
        </div>

        {/* Show either workspaces or no results message */}
        {hasResults ? (
          <>
            {allWorkspaces.map(workspace => (
              <WorkspaceCard key={workspace.slug || workspace.id} workspace={workspace} userData={userData} />
            ))}
            {/* Invisible trigger for auto-loading */}
            {hasNextPage && !hasActiveSearch && (
              <div ref={loadMoreRef} className="h-20 flex items-center justify-center">
                {isFetchingNextPage && (
                  <div className="flex items-center gap-2 text-sm text-textLight">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading more workspaces...
                  </div>
                )}
              </div>
            )}
          </>
        ) : hasActiveSearch ? (
          <div className="border border-textDisabled rounded-lg p-8 text-center bg-backgroundLight">
            <div className="text-lg font-medium text-textDark mb-2">No workspaces matching the query</div>
            <div className="text-sm text-textLight mb-6">
              Try adjusting your search terms or clear the search to see all workspaces
            </div>
            <Button type="default" onClick={() => setSearchQuery("")} className="px-6">
              Clear Search
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
};

// Pending invitations component
const PendingInvitations: React.FC = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [processingToken, setProcessingToken] = useState<string | null>(null);

  const {
    data: invitations,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["pending-invitations"],
    queryFn: async () => {
      const response = await get("/api/user/invitations");
      return response as Array<{
        id: string;
        token: string;
        workspaceId: string;
        workspaceName: string;
        email: string;
        role: string;
        createdAt: string;
      }>;
    },
  });

  const handleAccept = async (token: string, workspaceId: string) => {
    setProcessingToken(token);
    try {
      const result = await get("/api/user/accept", {
        method: "POST",
        body: { invitationToken: token },
      });

      if (result.accepted) {
        feedbackSuccess(`Successfully joined ${result.workspaceName}`);
        // Redirect to the new workspace
        router.push(`/${result.workspaceId}`);
      } else {
        feedbackError(result.details || "Failed to accept invitation");
      }
    } catch (e) {
      feedbackError("Failed to accept invitation", { error: e });
    } finally {
      setProcessingToken(null);
    }
  };

  const handleReject = async (token: string) => {
    setProcessingToken(token);
    try {
      const result = await get("/api/user/reject", {
        method: "POST",
        body: { invitationToken: token },
      });

      if (result.rejected) {
        feedbackSuccess("Invitation rejected");
        // Refresh invitations list
        await refetch();
      } else {
        feedbackError(result.details || "Failed to reject invitation");
      }
    } catch (e) {
      feedbackError("Failed to reject invitation", { error: e });
    } finally {
      setProcessingToken(null);
    }
  };

  if (isLoading) {
    return <></>;
  }

  if (error) {
    return null; // Silently fail for invitations
  }

  if (!invitations || invitations.length === 0) {
    return null;
  }

  return (
    <div className="mb-2">
      <div className="text-center mt-6 mb-4">
        <h2 className="text-2xl text-textDark flex items-center justify-center gap-2">
          <Mail className="w-5 h-5" />
          Workspace Invitations
        </h2>
      </div>
      <div className="flex flex-col space-y-4">
        {invitations.map(invitation => (
          <div
            key={invitation.id}
            className="border border-textDisabled rounded px-4 py-4 shadow hover:border-primaryDark hover:shadow-primaryLighter flex justify-between items-center hover:text-textPrimary group"
          >
            <div className="flex-1">
              <div className="font-medium">{invitation.workspaceName}</div>
              <div className="text-sm text-textLight mt-1">
                Role: <span className="font-medium">{invitation.role}</span> • Invited{" "}
                {new Date(invitation.createdAt).toLocaleDateString()}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="primary"
                icon={<CheckCircle className="w-4 h-4" />}
                loading={processingToken === invitation.token}
                disabled={processingToken !== null && processingToken !== invitation.token}
                onClick={() => handleAccept(invitation.token, invitation.workspaceId)}
              >
                Accept
              </Button>
              <Button
                danger
                icon={<XCircle className="w-4 h-4" />}
                loading={processingToken === invitation.token}
                disabled={processingToken !== null && processingToken !== invitation.token}
                onClick={() => handleReject(invitation.token)}
              >
                Reject
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const WorkspaceSelectionPage = (props: any) => {
  const router = useRouter();
  const sessionControl = useUserSessionControls();
  return (
    <div>
      <div className="flex justify-center">
        <div className="px-4 py-6 flex flex-col items-stretch w-full" style={{ maxWidth: "1000px", minWidth: "300px" }}>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <JitsuButton icon={<FaArrowLeft />} size="large" type="primary" onClick={() => router.back()}>
                Go back
              </JitsuButton>
              <Button
                type="text"
                size="small"
                className="text-textLight hover:text-textDark"
                onClick={sessionControl.logout}
              >
                Sign out
              </Button>
            </div>
            <JitsuButton
              size="large"
              type="default"
              onClick={async () => {
                await router.push("/new-workspace");
              }}
              icon={<FaPlus />}
            >
              New Workspace
            </JitsuButton>
          </div>
          <div className="w-full grow">
            <PendingInvitations />
            <WorkspacesList />
          </div>
        </div>
      </div>
      <div key="mistake" className="text-center my-4">
        Got here by mistake?{" "}
        <a className="cursor-pointer text-primary underline" onClick={sessionControl.logout}>
          Sign out
        </a>{" "}
      </div>
    </div>
  );
};
export default WorkspaceSelectionPage;
