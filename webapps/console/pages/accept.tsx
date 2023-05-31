import { useApi } from "../lib/useApi";
import { useRouter } from "next/router";
import { QueryResponse } from "../components/QueryResponse/QueryResponse";
import { FaCheckCircle, FaExclamationCircle } from "react-icons/fa";
import Link from "next/link";

const AcceptInvite = () => {
  const router = useRouter();
  const invitationToken = router.query.invite;
  const acceptResponse = useApi("/api/user/accept", { body: { invitationToken: invitationToken } });
  return (
    <div className="flex items-center justify-center">
      <div>
        <QueryResponse
          result={acceptResponse}
          render={result => {
            if (!result.accepted) {
              return (
                <div className="shadow-lg px-6 py-8 rounded-lg">
                  <div className="flex items-center">
                    <FaExclamationCircle className="text-error h-12 w-12 pr-4" />
                    <div className="text-2xl">Failed to accept invitation</div>
                  </div>
                  <div>{result.details}</div>
                  <div className="flex pt-5 justify-center text-lg">
                    <Link className="text-primary underline" href="/workspaces">
                      Go to available workspaces
                    </Link>
                  </div>
                </div>
              );
            }
            return (
              <div className="shadow-lg px-6 py-8 rounded-lg">
                <div className="flex items-center">
                  <FaCheckCircle className="text-success h-12 w-12 pr-4" />
                  <div className="text-2xl">Invitation accepted</div>
                </div>
                <div className="pt-5 text-lg">
                  Open{" "}
                  <Link className="text-primary underline bold" href={`/${result.workspaceId}`}>
                    {result.workspaceName}
                  </Link>{" "}
                  workspace
                </div>
              </div>
            );
          }}
          errorTitle="Can't accept invitation"
        />
      </div>
    </div>
  );
};

export default AcceptInvite;
