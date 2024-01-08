import React from "react";
import { useRouter } from "next/router";
import { CodeBlock } from "../components/CodeBlock/CodeBlock";
import Link from "next/link";

const CLI = () => {
  const router = useRouter();
  return (
    <div className="flex justify-center">
      <div className="px-4 py-6 flex flex-col items-center w-full" style={{ maxWidth: "1000px", minWidth: "300px" }}>
        <div className="w-full grow">
          <h1 className="flex-grow text-lg py-3">Jitsu CLI authorization</h1>
          <div className="px-8 py-6 border border-textDisabled rounded-lg">
            {router.query.code ? (
              <>
                <div className="text-lg mb-1">Code:</div>
                <CodeBlock breaks={"all"} lang="plaintext">
                  {router.query.code}
                </CodeBlock>
                <div className="mt-4">Paste this code to the terminal and press Enter to authorize Jitsu CLI</div>
                <div className="mt-4">
                  The dedicated API key was created for this CLI authorization. You can revoke it on user{" "}
                  <Link className="primary underline" href="/user">
                    user settings page
                  </Link>
                </div>
              </>
            ) : router.query.err ? (
              <>
                <div className="text-lg mb-1">Error:</div>
                <div className="text-red-500 border border-textDisabled rounded px-2.5 py-1.5">{router.query.err}</div>
              </>
            ) : (
              <div>
                <b>Success!</b> You can close this window and return to the terminal.
                <p className="mt-3">
                  A special API key that starts with <code>jitsu-cli</code> has been created. You can edit a list of API
                  keys on{" "}
                  <Link className="underline text-primary" href="/user">
                    User Profile page
                  </Link>
                  .
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CLI;
