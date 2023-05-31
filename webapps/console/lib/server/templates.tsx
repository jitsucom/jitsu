import {
  Mjml,
  MjmlHead,
  MjmlTitle,
  MjmlPreview,
  MjmlBody,
  MjmlSection,
  MjmlColumn,
  MjmlButton,
  MjmlText,
  MjmlFont,
  MjmlAttributes,
} from "mjml-react";
import { branding } from "../branding";

type InvitationEmailProps = {
  link?: string;
  invitee?: { email?: string };
  inviting?: { email?: string; name?: string };
  workspaceName?: string;
};

export const InvitationsEmail = ({
  invitee: { email: inviteeEmail = "jack@acmecorp.com" } = {},
  inviting: { email: invitingEmail = "john.doe@xyzco.net", name: invitingName = "John Doe" } = {},
  workspaceName = "XYZ Co. Workspace",
  link = "https://bugus.invitation.link",
}: InvitationEmailProps) => {
  return (
    <Mjml>
      <MjmlFont name="Inter" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700" />

      <MjmlHead>
        <MjmlTitle>
          {invitingName} invites you to join {workspaceName} in {branding.productName}
        </MjmlTitle>
        <MjmlPreview>
          {invitingName} invites you to join {workspaceName} in {branding.productName}
        </MjmlPreview>
        <MjmlAttributes></MjmlAttributes>
      </MjmlHead>
      <MjmlBody>
        <MjmlSection>
          <MjmlColumn>
            <MjmlText>
              {invitingName} invites you to join {workspaceName} in {branding.productName}
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>
        <MjmlSection>
          <MjmlColumn>
            <MjmlButton padding="20px" backgroundColor="#346DB7" href={link}>
              Join {workspaceName}
            </MjmlButton>
          </MjmlColumn>
        </MjmlSection>
      </MjmlBody>
    </Mjml>
  );
};

InvitationsEmail.isMjml = true;
