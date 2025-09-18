import { ConnectionStatusFailedEmail } from "../../emails/connection-status-failed";
import { ConnectionStatusOngoingEmail } from "../../emails/connection-status-ongoing";
import { ConnectionStatusFlappingEmail } from "../../emails/connection-status-flapping";
import { ConnectionStatusRecoveredEmail } from "../../emails/connection-status-recovered";
import { ConnectionStatusFirstRunEmail } from "../../emails/connection-status-firstrun";
import { ConnectionStatusPartialEmail } from "../../emails/connection-status-partial";

import { Select } from "antd";
import { useState, useEffect } from "react";
import { EmailTemplate } from "@jitsu-internal/webapps-shared";
import { CodeEditor } from "../../components/CodeEditor/CodeEditor";
import { render } from "@react-email/render";

const templates = {
  "connection-status-failed": ConnectionStatusFailedEmail,
  "connection-status-ongoing": ConnectionStatusOngoingEmail,
  "connection-status-flapping": ConnectionStatusFlappingEmail,
  "connection-status-recovered": ConnectionStatusRecoveredEmail,
  "connection-status-firstrun": ConnectionStatusFirstRunEmail,
  "connection-status-partial": ConnectionStatusPartialEmail,
};

const defaultComponent = p => <div>Please select template</div>;
defaultComponent.subject = () => "Please select template";

const EmailPreviewPage = () => {
  const [template, setTemplate] = useState("");
  const [previewValues, setPreviewValues] = useState<any>({});
  const [plainText, setPlainText] = useState("");
  const [subject, setSubject] = useState("");

  // useStates returns functions as objects so they cannot be rendered. So put func as object property
  const [component, setComponent] = useState<{
    reactFC: EmailTemplate<any>;
  }>({
    reactFC: defaultComponent,
  });

  useEffect(() => {
    const component = templates[template];
    if (component) {
      setComponent({ reactFC: component });
      setPreviewValues(component.PreviewProps || {});
    } else {
      setComponent({ reactFC: defaultComponent });
      setPreviewValues({});
    }
  }, [template]);

  useEffect(() => {
    (async () => {
      const MailBody = component.reactFC;
      setPlainText(
        component.reactFC.plaintext
          ? component.reactFC.plaintext(previewValues)
          : await render(<MailBody {...previewValues} />, { plainText: true })
      );
      setSubject(component.reactFC.subject(previewValues));
    })();
  }, [component, previewValues]);

  const MailBody = component.reactFC;

  return (
    <div className={"w-full h-full bg-backgroundDark"}>
      <div className={"w-full pb-12 flex flex-col items-center bg-backgroundDark gap-4"}>
        <div className={"flex-grow-0 flex flex-row items-center gap-2 mt-6"}>
          <div>Select template: </div>
          <Select value={template} className={"w-96"} onChange={e => setTemplate(e)}>
            {Object.keys(templates).map(t => (
              <Select.Option key={t} value={t}>
                {t}
              </Select.Option>
            ))}
          </Select>
        </div>
        <div>
          Preview values:
          <div className={"flex-grow-0 border rounded-lg bg-white overflow-hidden"}>
            <CodeEditor
              height={"200px"}
              width={"600px"}
              language={"json"}
              onChange={value => {
                try {
                  setPreviewValues(JSON.parse(value));
                } catch (e) {
                  console.error(e);
                }
              }}
              value={JSON.stringify(previewValues, null, 2)}
            ></CodeEditor>
          </div>
        </div>
        <div className={"flex-grow-0 flex flex-row items-center gap-2 mt-2"}>
          <div>Subject: </div>
          <div className={"bg-white py-2 px-4 border rounded-lg"} style={{ minWidth: 540 }}>
            {subject}
          </div>
        </div>
        <div className={"flex-grow flex flex-row gap-4"}>
          <div className={"flex-grow border rounded-lg overflow-auto p-6 bg-white resize"} style={{ width: "800px" }}>
            <MailBody {...previewValues} />
          </div>
          <div
            className={
              "flex-grow border rounded-lg overflow-auto whitespace-pre-wrap p-6 bg-white resize font-mono text-s"
            }
            style={{ width: "800px" }}
          >
            {plainText}
          </div>
        </div>
      </div>
    </div>
  );
};
export default EmailPreviewPage;
