import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { BookOpen, MailCheck } from "lucide-react";
import { ReactNode } from "react";
import { useWorkspace } from "../../lib/context";
import classNames from "classnames";
import Link from "next/link";

function SlackLogo({ className }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 50 50">
      <path d="M31 24c-2.757 0-5-2.243-5-5V7c0-2.757 2.243-5 5-5s5 2.243 5 5v12C36 21.757 33.757 24 31 24zM43 24h-4c-.553 0-1-.447-1-1v-4c0-2.757 2.243-5 5-5s5 2.243 5 5S45.757 24 43 24zM19 24H7c-2.757 0-5-2.243-5-5s2.243-5 5-5h12c2.757 0 5 2.243 5 5S21.757 24 19 24zM23 12h-4c-2.757 0-5-2.243-5-5s2.243-5 5-5 5 2.243 5 5v4C24 11.553 23.553 12 23 12zM19 48c-2.757 0-5-2.243-5-5V31c0-2.757 2.243-5 5-5s5 2.243 5 5v12C24 45.757 21.757 48 19 48zM7 36c-2.757 0-5-2.243-5-5s2.243-5 5-5h4c.553 0 1 .447 1 1v4C12 33.757 9.757 36 7 36zM43 36H31c-2.757 0-5-2.243-5-5s2.243-5 5-5h12c2.757 0 5 2.243 5 5S45.757 36 43 36zM31 48c-2.757 0-5-2.243-5-5v-4c0-.553.447-1 1-1h4c2.757 0 5 2.243 5 5S33.757 48 31 48z"></path>
    </svg>
  );
}
const SupportOption: React.FC<{ icon: ReactNode; title: ReactNode; children: ReactNode; link: string }> = props => {
  return (
    <div
      className={"flex flex-row border rounded-lg border-neutral-300 px-12 py-8 items-start"}
      style={{ width: "30rem" }}
    >
      <div className=" mr-6">
        <div className="w-12 h-12">{props.icon}</div>
      </div>
      <div>
        <h3 className="text-2xl">{props.title}</h3>
        <div className="my-4 text-neutral-500 text-normal font-thin">{props.children}</div>
      </div>
    </div>
  );
};

function Support() {
  const workaces = useWorkspace();
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <BookOpen className="w-12 h-12 my-6" />
      <h1 className="text-5xl font-bold text-center text-neutral-900">Hey, how can we help?</h1>
      <div className="flex justify-evenly flex-wrap gap-12 mt-12">
        <SupportOption
          icon={<MailCheck className="w-full h-full" />}
          title="Get Support"
          link="mailto:support@jitsu.com"
        >
          Email us at{" "}
          <a className="font-bold underline text-primaryDark" href="mailto:support@jitsu.com">
            support@jitsu.com
          </a>
          , and we'll get back to you as soon as possible. To expedite the process, please include your workspace ID in
          the email: <code>{workaces.id}</code>
        </SupportOption>
        <SupportOption
          icon={<SlackLogo className="w-full h-full" />}
          title={"Ask the Community"}
          link="https://jitsu.com"
        >
          Join our{" "}
          <a href="https://jitsu.com/slack" className="underline text-primaryDark">
            Slack Community
          </a>{" "}
          to ask questions and get help from other users.
        </SupportOption>
      </div>
      <div>
        <Link
          href={`https://docs.jitsu.com`}
          className={classNames("block mt-12 text-primaryDark font-bold text-lg underline")}
        >
          View our documentation
        </Link>
      </div>
    </div>
  );
}

const SupportPage: React.FC = () => {
  return (
    <WorkspacePageLayout>
      <Support />
    </WorkspacePageLayout>
  );
};

export default SupportPage;
