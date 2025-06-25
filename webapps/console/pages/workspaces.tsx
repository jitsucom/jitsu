import { useRouter } from "next/router";
import { FaArrowLeft, FaPlus } from "react-icons/fa";
import { get } from "../lib/useApi";
import { z } from "zod";
import { WorkspaceDbModel } from "../prisma/schema";
import { ArrowRight, Loader2 } from "lucide-react";
import { EmbeddedErrorMessage } from "../components/GlobalError/GlobalError";
import { getLog } from "juava";
import Link from "next/link";
import React, { useState, useMemo, useRef, useEffect } from "react";
import { feedbackError } from "../lib/ui";
import { JitsuButton } from "../components/JitsuButton/JitsuButton";
import { Input, Tag, Button, Skeleton } from "antd";
import { useQueryStringState } from "../lib/useQueryStringState";
import { branding } from "../lib/branding";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import { useUserSessionControls } from "../lib/context";

const log = getLog("worspaces");

// Header component with title and subtitle
const WorkspaceHeader: React.FC<{ subtitle: string }> = ({ subtitle }) => (
  <div className="text-center py-6">
    <h1 className="text-3xl mb-2">👋 Select workspace</h1>
    <p className="text-lg text-textLight">{subtitle}</p>
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
  useMemo(() => {
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
        <div className="text-3xl flex items-center justify-center gap-2">
          <span className="w-8 h-8 inline-block">{branding.logo}</span> No workspaces found.
        </div>
        <JitsuButton
          size="large"
          type="primary"
          onClick={async () => {
            try {
              const { id } = await get("/api/workspace", { method: "POST", body: {} });
              await router.push(`/${id}`);
            } catch (e) {
              feedbackError(`Can't create new workspace`, { error: e });
            }
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
        subtitle={`${displayCount.toLocaleString()} workspace${displayCount === 1 ? "" : "s"} available`}
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

const WorkspaceSelectionPage = (props: any) => {
  const router = useRouter();
  const sessionControl = useUserSessionControls();
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
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
                setCreatingWorkspace(true);
                try {
                  const { id } = await get("/api/workspace", { method: "POST", body: {} });
                  await router.push(`/${id}`);
                } catch (e) {
                  feedbackError(`Can't create new workspace`, { error: e });
                } finally {
                  setCreatingWorkspace(false);
                }
              }}
              loading={creatingWorkspace}
              icon={<FaPlus />}
              disabled={creatingWorkspace}
            >
              New Workspace
            </JitsuButton>
          </div>
          <div className="w-full grow">
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
